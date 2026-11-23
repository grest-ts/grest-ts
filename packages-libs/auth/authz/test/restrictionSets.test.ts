import {describe, expect, test, vi} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, IsGGAuthzSubject, type GGAuthzSubject} from "../src/index-node"
import {notHeld} from "./util"

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

describe("a restriction set that asks on a miss", () => {
    const floored = new GGAuthz({
        model: {...model, approvalFloor: [{actions: ["git:Delete"], level: "critical" as const}]},
        policies: {bindings: [{principal: "user:ann", role: "writer", on: org}, {principal: "user:ben", role: "reader", on: org}], roles: [{name: "reader", actions: ["git:Read"]}]},
        resolver: new GGAuthzMemoryResolver({parents: {[repo("site")]: org}}),
    })
    const given = {id: "given", miss: "ask" as const, rules: [{actions: ["git:Read"]}, {actions: ["git:Push"], when: ["home"]}]}
    const on = (subject: GGAuthzSubject, action: string, context?: Record<string, unknown>) =>
        floored.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id: repo("site")}, context})
    const benAgent: GGAuthzSubject = {type: "agent", id: "ws-ben", properties: {onBehalfOf: {type: "user", id: "ben"}, restrictionSets: [given]}}

    test("a workload's request outside the rules needs approval at the set's level, named by its id", async () => {
        const d = await on(agent({restrictionSets: [{...given, rules: [{actions: ["git:Read"]}]}]}), "git:Push")
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "ask"})
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "ask", source: "restriction", id: "given"}))
    })

    test("a request a rule covers gets no level; a rule whose fact is false or unknown doesn't cover it", async () => {
        expect((await on(agent({restrictionSets: [given]}), "git:Read")).context).toMatchObject({outcome: "allow", approval: "auto"})
        expect((await on(agent({restrictionSets: [given]}), "git:Push", {home: true})).context.approval).toBe("auto")
        expect((await on(agent({restrictionSets: [given]}), "git:Push", {home: false})).context.approval).toBe("ask")
        expect((await on(agent({restrictionSets: [given]}), "git:Push")).context.approval).toBe("ask")
    })

    test("it never permits: what the human isn't granted is still denied", async () => {
        const d = await on(benAgent, "git:Push", {home: false})
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({kind: "no-grant"})])
    })

    test("a set without `miss` still refuses next to it", async () => {
        const d = await on(agent({restrictionSets: [given, {id: "own", rules: [{actions: ["git:Read"]}]}]}), "git:Push", {home: false})
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({kind: "ceiling-failed", id: "own"})])
    })

    test("a stricter or equal floor or ask sets the level instead", async () => {
        const floor = await on(agent({restrictionSets: [given]}), "git:Delete")
        expect(floor.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "critical", source: "floor"}))
        const asked = await on(agent({restrictionSets: [given], asks: [{actions: ["git:Push"], level: "ask", ref: "a1"}]}), "git:Push", {home: false})
        expect(asked.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "ask", source: "ask", ref: "a1"}))
        const lower = await on(agent({restrictionSets: [given], asks: [{actions: ["git:Push"], level: "ask-once"}]}), "git:Push", {home: false})
        expect(lower.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "ask", source: "restriction"}))
    })

    test("a humans-only floor still shuts the workload out", async () => {
        const closed = new GGAuthz({
            model: {...model, approvalFloor: [{actions: ["git:Delete"], level: "humans-only" as const}]},
            policies: {bindings: [{principal: "user:ann", role: "writer", on: org}]},
            resolver: new GGAuthzMemoryResolver({parents: {[repo("site")]: org}}),
        })
        const d = await closed.evaluate({subject: agent({restrictionSets: [given]}), action: {name: "git:Delete"}, resource: {type: "git:repo", id: repo("site")}})
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "approval", level: "humans-only"})])
    })

    test("only a workload is asked: a person carrying the set is refused", async () => {
        const d = await on({type: "user", id: "ann", properties: {restrictionSets: [given]}}, "git:Delete")
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({kind: "ceiling-failed", id: "given"})])
    })

    test("lists and held actions count only what the rules cover", async () => {
        const subject = agent({restrictionSets: [{...given, rules: [{actions: ["git:Read"], resources: [repo("site")]}]}]})
        const plan = await floored.listAllowed({subject, action: {name: "git:Read"}, resource: {type: "git:repo"}})
        expect(plan.require).toEqual([{id: "given", within: undefined, anyOf: [{resources: [repo("site")]}]}])
        expect((await floored.listAllowed({subject, action: {name: "git:Push"}, resource: {type: "git:repo"}})).include).toEqual([])
        expect(notHeld(await floored.canHold({subject, actions: ["git:Read", "git:Push"], on: repo("site")}))).toEqual(["git:Push"])
    })

    test("`miss` is an ask level only: the schema rejects another, and the engine throws instead of deciding", async () => {
        expect(IsGGAuthzSubject.is(agent({restrictionSets: [given]}))).toBe(true)
        for (const miss of ["auto", "humans-only", "asks"]) {
            const subject = agent({restrictionSets: [{...given, miss: miss as never}]})
            expect(IsGGAuthzSubject.is(subject), miss).toBe(false)
            await expect(on(subject, "git:Push", {home: false}), miss).rejects.toThrow(/miss must be an ask level/)
        }
    })
})
