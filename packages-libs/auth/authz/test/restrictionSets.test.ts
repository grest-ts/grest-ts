import {describe, expect, test, vi} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, IsGGAuthzSubject, type GGAuthzSubject} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const repo = (id: string) => `rn:acme:git:acme:repo/${id}`

const model = {
    partition: "acme",
    actions: ["git:Read", "git:Push", "git:Delete"].map(name => ({name, resourceTypes: ["git:repo"]})),
    roles: [{name: "writer", actions: ["git:*"]}],
    workloadTypes: ["agent"],
}
const authz = new GGAuthz({
    model,
    policies: {bindings: [{principal: "user:ann", role: "writer", on: org}]},
    resolver: new GGAuthzMemoryResolver({parents: {[repo("site")]: org}}),
})

const agent = (properties: NonNullable<GGAuthzSubject["properties"]>): GGAuthzSubject => ({type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}, ...properties}})
const decide = (subject: GGAuthzSubject, action: string) => authz.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id: repo("site")}})

describe("restriction sets: several per-request ceilings", () => {
    const own = {id: "own", rules: [{actions: ["git:Read"]}, {actions: ["git:Push"]}]}
    const app = {id: "app", rules: [{actions: ["git:Read"]}, {actions: ["git:Push"]}, {actions: ["git:Delete"]}]}

    test("they intersect: an action outside either set is denied by that set", async () => {
        const d = await decide(agent({restrictionSets: [own, app]}), "git:Delete")
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "own"})])
        expect((await decide(agent({restrictionSets: [own, app]}), "git:Read")).context.outcome).toBe("allow")
    })

    test("a set only allows: an action in every set passes with no level of its own", async () => {
        expect((await decide(agent({restrictionSets: [own, app]}), "git:Push")).context).toMatchObject({outcome: "allow", approval: "auto"})
    })

    test("they combine with the single `restrictions` set; every refusing set is reported", async () => {
        const d = await decide(agent({restrictions: [{actions: ["git:Push"]}], restrictionSets: [own]}), "git:Read")
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "request restrictions"})])
        expect((await decide(agent({restrictionSets: [app, own]}), "git:Delete")).context.reasons).toEqual([expect.objectContaining({id: "own"})])
        const readOnly = {id: "read-only", rules: [{actions: ["git:Read"]}]}
        expect((await decide(agent({restrictionSets: [own, readOnly]}), "git:Delete")).context.reasons).toEqual([
            expect.objectContaining({kind: "ceiling-failed", id: "own"}),
            expect.objectContaining({kind: "ceiling-failed", id: "read-only"}),
        ])
    })

    test("an empty list adds no ceiling; a set without rules allows nothing", async () => {
        expect((await decide(agent({restrictionSets: []}), "git:Delete")).decision).toBe(true)
        expect((await decide(agent({restrictionSets: [{id: "none", rules: []}]}), "git:Read")).context.reasons).toEqual([expect.objectContaining({kind: "ceiling-failed", id: "none"})])
    })

    test("the subject schema rejects duplicate set ids", () => {
        expect(IsGGAuthzSubject.is(agent({restrictionSets: [own, app]}))).toBe(true)
        expect(IsGGAuthzSubject.is(agent({restrictionSets: [own, {...app, id: "own"}]}))).toBe(false)
    })

    test("an action the model doesn't know only narrows a set", async () => {
        const stale = {id: "stale", rules: [{actions: ["git:Archive", "git:Read"]}]}
        expect((await decide(agent({restrictionSets: [stale]}), "git:Read")).decision).toBe(true)
        expect((await decide(agent({restrictionSets: [stale]}), "git:Push")).decision).toBe(false)
    })

    test("a set's conditions load the attributes they need for that request only", async () => {
        const resolver = new GGAuthzMemoryResolver({parents: {[repo("site")]: org}, attributes: {[repo("site")]: {owner: "ann"}}})
        const loads = vi.spyOn(resolver, "attributes")
        const own = new GGAuthz({model, policies: {bindings: [{principal: "user:ann", role: "writer", on: org}]}, resolver})
        const owned = {id: "owned", rules: [{actions: ["git:Read"], conditions: [{key: "resource.owner", op: "eq" as const, value: "ann"}]}]}
        const read = (subject: GGAuthzSubject) => own.evaluate({subject, action: {name: "git:Read"}, resource: {type: "git:repo", id: repo("site")}})
        expect((await read(agent({restrictionSets: [owned]}))).decision).toBe(true)
        expect(loads).toHaveBeenCalledWith(repo("site"))
        loads.mockClear()
        expect((await read(agent({}))).decision).toBe(true)
        expect(loads).not.toHaveBeenCalledWith(repo("site"))
    })

    test("list plans require every set", async () => {
        const plan = await authz.listAllowed({subject: agent({restrictionSets: [own, {id: "site-only", rules: [{actions: ["git:Read"], resources: [repo("site")]}]}]}), action: {name: "git:Read"}, resource: {type: "git:repo"}})
        expect(plan.require).toEqual([{id: "site-only", within: undefined, anyOf: [{resources: [repo("site")]}]}])
    })
})
