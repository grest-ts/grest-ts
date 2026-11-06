import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzPolicies, type GGAuthzSubject} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const repo = (id: string) => `rn:acme:git:acme:repo/${id}`

const model = {
    partition: "acme",
    actions: ["git:Read", "git:Push", "git:Delete", "git:Admin"].map(name => ({name, resourceTypes: ["git:repo"]})),
    roles: [{name: "writer", actions: ["git:*"]}],
    workloadTypes: ["agent", "client"],
    approvalFloor: [{actions: ["git:Delete"], level: "ask" as const}],
}
const data = {parents: {[repo("site")]: org, [repo("prod")]: org}}

function engine(extra: Partial<GGAuthzPolicies> = {}) {
    return new GGAuthz({
        model,
        policies: {bindings: [{principal: "user:ann", role: "writer", on: org, ref: "binding-1"}], ...extra},
        resolver: new GGAuthzMemoryResolver(data),
    })
}

const agent = (properties: NonNullable<GGAuthzSubject["properties"]> = {}): GGAuthzSubject => ({type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}, ...properties}})
const decide = (authz: GGAuthz, subject: GGAuthzSubject, action: string, id = repo("site")) =>
    authz.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id}})

describe("reasons carry the deciding id and the author's ref", () => {
    test("bindings, ceiling rules and the approval level they set", async () => {
        const authz = engine({boundaries: [{id: "agents", principals: ["agent:*"], allow: [{actions: ["git:Push"], approval: "critical", ref: "boundary-rule"}]}]})
        const d = await decide(authz, agent(), "git:Push")
        expect(d.context.reasons).toEqual([
            expect.objectContaining({layer: "allow", kind: "binding", ref: "binding-1"}),
            expect.objectContaining({layer: "boundary", kind: "ceiling-passed", id: "agents", ref: "boundary-rule"}),
            expect.objectContaining({layer: "approval", level: "critical", source: "boundary", id: "agents", ref: "boundary-rule"}),
        ])
    })

    test("guardrail and statement denies", async () => {
        const authz = engine({
            guardrails: [{id: "no-delete", on: org, deny: [{actions: ["git:Delete"], ref: "assignment-7"}]}],
            resourcePolicies: [{on: repo("prod"), statements: [{sid: "freeze", effect: "deny", principals: ["everyone"], actions: ["git:Push"], ref: "assignment-8"}]}],
        })
        expect((await decide(authz, {type: "user", id: "ann"}, "git:Delete")).context.reasons).toEqual([expect.objectContaining({layer: "guardrail", id: "no-delete", ref: "assignment-7"})])
        expect((await decide(authz, {type: "user", id: "ann"}, "git:Push", repo("prod"))).context.reasons).toEqual([expect.objectContaining({layer: "deny", id: "freeze", ref: "assignment-8"})])
    })

    test("the approval level's source tells the platform floor from a policy and the default", async () => {
        const authz = engine({resourcePolicies: [{on: repo("prod"), approvals: [{actions: ["git:Push"], level: "ask"}]}]})
        const approval = async (action: string, id?: string) => (await decide(authz, agent(), action, id)).context.reasons.find(r => r.layer === "approval")
        expect(await approval("git:Delete")).toMatchObject({level: "ask", source: "floor", locked: true})
        expect(await approval("git:Push", repo("prod"))).toMatchObject({level: "ask", source: "policy", on: repo("prod")})
        expect(await approval("git:Read")).toMatchObject({level: "auto", source: "default"})
    })

    test("a failed ceiling also reports a humans-only level beneath it", async () => {
        const authz = engine({resourcePolicies: [{on: org, approvals: [{actions: ["git:Admin"], level: "humans-only"}]}]})
        const d = await decide(authz, agent({restrictions: [{actions: ["git:Read"]}]}), "git:Admin")
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([
            expect.objectContaining({layer: "restriction", kind: "ceiling-failed"}),
            expect.objectContaining({layer: "approval", level: "humans-only", source: "policy"}),
        ])
        expect((await decide(authz, agent({restrictions: [{actions: ["git:Read"]}]}), "git:Push")).context.reasons).toEqual([expect.objectContaining({layer: "restriction"})])
    })
})

describe("restriction sets: several per-request ceilings", () => {
    const own = {id: "own", rules: [{actions: ["git:Read"]}, {actions: ["git:Push"], approval: "ask" as const, ref: "own-push"}]}
    const app = {id: "app", rules: [{actions: ["git:Read"]}, {actions: ["git:Push"], approval: "critical" as const, ref: "app-push"}, {actions: ["git:Delete"]}]}

    test("they intersect: an action outside either set is denied by that set", async () => {
        const authz = engine()
        const d = await decide(authz, agent({restrictionSets: [own, app]}), "git:Delete")
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "own"})])
        expect((await decide(authz, agent({restrictionSets: [own, app]}), "git:Read")).context.outcome).toBe("allow")
    })

    test("the strictest set's level counts", async () => {
        const d = await decide(engine(), agent({restrictionSets: [own, app]}), "git:Push")
        expect(d.context.approval).toBe("critical")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", source: "restriction", id: "app", ref: "app-push"}))
    })

    test("they combine with the single `restrictions` set; the first refusing set is reported", async () => {
        const authz = engine()
        const d = await decide(authz, agent({restrictions: [{actions: ["git:Push"]}], restrictionSets: [own]}), "git:Read")
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "request restrictions"})])
        expect((await decide(authz, agent({restrictionSets: [app, own]}), "git:Delete")).context.reasons).toEqual([expect.objectContaining({id: "own"})])
    })

    test("list plans require every set", async () => {
        const plan = await engine().listAllowed({subject: agent({restrictionSets: [own, {id: "site-only", rules: [{actions: ["git:Read"], resources: [repo("site")]}]}]}), action: {name: "git:Read"}, resource: {type: "git:repo"}})
        expect(plan.require).toEqual([{id: "site-only", within: undefined, anyOf: [{resources: [repo("site")]}]}])
    })
})
