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
    test("bindings, ceiling rules and the ask that sets the level", async () => {
        const authz = engine({boundaries: [{id: "agents", principals: ["agent:*"], allow: [{actions: ["git:Push"], ref: "boundary-rule"}]}]})
        const d = await decide(authz, agent({asks: [{actions: ["git:Push"], level: "critical", ref: "ask-1"}]}), "git:Push")
        expect(d.context.reasons).toEqual([
            expect.objectContaining({layer: "allow", kind: "binding", ref: "binding-1"}),
            expect.objectContaining({layer: "boundary", kind: "ceiling-passed", id: "agents", ref: "boundary-rule"}),
            expect.objectContaining({layer: "approval", level: "critical", source: "ask", ref: "ask-1"}),
        ])
        const request = {subject: agent(), action: {name: "git:Push"}, resource: {type: "git:repo", id: repo("site")}}
        expect(GGAuthz.explain(request, d)).toContain("approval level critical (ask ask-1)")
    })

    test("token scope and restriction rules", async () => {
        const authz = new GGAuthz({
            model: {...model, tokenScopes: [{name: "repo:write", allow: [{actions: ["git:Push"], ref: "scope-rule"}]}]},
            policies: {bindings: [{principal: "user:ann", role: "writer", on: org}]},
            resolver: new GGAuthzMemoryResolver(data),
        })
        const d = await decide(authz, agent({scopes: ["repo:write"], restrictions: [{actions: ["git:Push"], ref: "restriction-rule"}]}), "git:Push")
        expect(d.context.reasons).toEqual(expect.arrayContaining([
            expect.objectContaining({layer: "scope", kind: "ceiling-passed", id: "repo:write", ref: "scope-rule"}),
            expect.objectContaining({layer: "restriction", kind: "ceiling-passed", ref: "restriction-rule"}),
        ]))
    })

    test("a policy below the platform floor leaves the floor as the source", async () => {
        const authz = engine({resourcePolicies: [{on: repo("site"), approvals: [{actions: ["git:Delete"], level: "auto"}]}]})
        const approval = (await decide(authz, agent(), "git:Delete")).context.reasons.find(r => r.layer === "approval")
        expect(approval).toMatchObject({level: "ask", source: "floor", lowered: {on: repo("site"), level: "auto"}})
    })

    test("canGrant reasons carry the requested binding's ref", async () => {
        const binding = {principal: "user:ben", role: "writer", on: repo("site"), ref: "grant-1"}
        expect((await engine().canGrant({subject: {type: "user", id: "ann"}, binding})).context.reasons).toContainEqual(expect.objectContaining({layer: "grant", ref: "grant-1"}))
        expect((await engine().canGrant({subject: {type: "user", id: "ben"}, binding})).context.reasons).toEqual([expect.objectContaining({kind: "escalation", ref: "grant-1"})])
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
