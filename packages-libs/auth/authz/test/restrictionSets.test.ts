import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzSubject} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const repo = (id: string) => `rn:acme:git:acme:repo/${id}`

const authz = new GGAuthz({
    model: {
        partition: "acme",
        actions: ["git:Read", "git:Push", "git:Delete"].map(name => ({name, resourceTypes: ["git:repo"]})),
        roles: [{name: "writer", actions: ["git:*"]}],
        workloadTypes: ["agent"],
    },
    policies: {bindings: [{principal: "user:ann", role: "writer", on: org}]},
    resolver: new GGAuthzMemoryResolver({parents: {[repo("site")]: org}}),
})

const agent = (properties: NonNullable<GGAuthzSubject["properties"]>): GGAuthzSubject => ({type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}, ...properties}})
const decide = (subject: GGAuthzSubject, action: string) => authz.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id: repo("site")}})

describe("restriction sets: several per-request ceilings", () => {
    const own = {id: "own", rules: [{actions: ["git:Read"]}, {actions: ["git:Push"], approval: "ask" as const}]}
    const app = {id: "app", rules: [{actions: ["git:Read"]}, {actions: ["git:Push"], approval: "critical" as const}, {actions: ["git:Delete"]}]}

    test("they intersect: an action outside either set is denied by that set", async () => {
        const d = await decide(agent({restrictionSets: [own, app]}), "git:Delete")
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "own"})])
        expect((await decide(agent({restrictionSets: [own, app]}), "git:Read")).context.outcome).toBe("allow")
    })

    test("the strictest set's level counts", async () => {
        const d = await decide(agent({restrictionSets: [own, app]}), "git:Push")
        expect(d.context.approval).toBe("critical")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "critical", message: "restriction app"}))
    })

    test("they combine with the single `restrictions` set; the first refusing set is reported", async () => {
        const d = await decide(agent({restrictions: [{actions: ["git:Push"]}], restrictionSets: [own]}), "git:Read")
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "request restrictions"})])
        expect((await decide(agent({restrictionSets: [app, own]}), "git:Delete")).context.reasons).toEqual([expect.objectContaining({id: "own"})])
    })

    test("list plans require every set", async () => {
        const plan = await authz.listAllowed({subject: agent({restrictionSets: [own, {id: "site-only", rules: [{actions: ["git:Read"], resources: [repo("site")]}]}]}), action: {name: "git:Read"}, resource: {type: "git:repo"}})
        expect(plan.require).toEqual([{id: "site-only", within: undefined, anyOf: [{resources: [repo("site")]}]}])
    })
})
