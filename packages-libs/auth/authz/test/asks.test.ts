import {describe, expect, test, vi} from "vitest"
import {defineAuthzModel, defineAuthzService, GGAuthz, GGAuthzMemoryResolver, type GGAuthzAsk, type GGAuthzFloorRule, type GGAuthzPolicies, type GGAuthzSubject, IsGGAuthzAsk, IsGGAuthzModel} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const repo = (id: string) => `rn:acme:git:acme:repo/${id}`
const parent = (id: string) => ({key: "resource.parent", op: "eq" as const, value: id})

const model = (approvalFloor: GGAuthzFloorRule[] = [{actions: ["git:Delete"], level: "ask"}]) => ({
    partition: "acme",
    actions: ["git:Read", "git:Push", "git:Delete"].map(name => ({name, resourceTypes: ["git:repo"]})),
    roles: [{name: "writer", actions: ["git:*"]}],
    workloadTypes: ["agent"],
    approvalFloor,
})
const data = {parents: {[repo("site")]: org, [repo("prod")]: org}, attributes: {[repo("site")]: {parent: "agent:ws-ann"}, [repo("prod")]: {parent: "agent:other", approvalLevel: "critical"}}}

function engine(floor?: GGAuthzFloorRule[], extra: Partial<GGAuthzPolicies> = {}, resolver = new GGAuthzMemoryResolver(data), approvalLevelAttribute?: string) {
    return new GGAuthz({model: model(floor), policies: {bindings: [{principal: "user:ann", role: "writer", on: org}], ...extra}, resolver, approvalLevelAttribute})
}

const agent = (asks: GGAuthzAsk[], restrictionSets?: {id: string, rules: {actions: string[]}[]}[]): GGAuthzSubject =>
    ({type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}, asks, restrictionSets}})
const decide = (authz: GGAuthz, subject: GGAuthzSubject, action: string, id = repo("site"), context?: Record<string, unknown>) =>
    authz.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id}, context})

describe("asks raise a workload's approval level", () => {
    test("the strictest applying ask sets the level and is reported with its ref", async () => {
        const d = await decide(engine(), agent([{actions: ["git:Push"], level: "ask-once", ref: "a1"}, {actions: ["git:*"], level: "critical", ref: "a2"}]), "git:Push")
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "critical"})
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "critical", source: "ask", ref: "a2", message: "ask a2"}))
    })

    test("an ask that doesn't name the action leaves the level", async () => {
        const d = await decide(engine(), agent([{actions: ["git:Read"], level: "critical"}]), "git:Delete")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "ask", source: "floor"}))
    })

    test("a known-true `unless` suppresses an ask", async () => {
        const asks: GGAuthzAsk[] = [{actions: ["git:Push"], unless: ["spawned"], level: "ask"}]
        expect((await decide(engine(), agent(asks), "git:Push", repo("site"), {spawned: true})).context.approval).toBe("auto")
        expect((await decide(engine(), agent(asks), "git:Push", repo("site"), {spawned: false})).context.approval).toBe("ask")
    })

    test("an ask naming an unknown action throws: a typo must not silently never apply", async () => {
        await expect(decide(engine(), agent([{actions: ["git:Pussh"], level: "ask"}]), "git:Read")).rejects.toThrow("Unknown action git:Pussh")
    })

    test("an ask never turns a humans-only floor or policy into an approval", async () => {
        const critical = agent([{actions: ["git:*"], level: "critical"}])
        expect((await decide(engine([{actions: ["git:Delete"], level: "humans-only"}]), critical, "git:Delete")).decision).toBe(false)
        const policy = engine(undefined, {resourcePolicies: [{on: org, approvals: [{actions: ["git:Push"], level: "humans-only"}]}]})
        expect((await decide(policy, critical, "git:Push")).decision).toBe(false)
    })

    test("an allow in another set never erases an ask", async () => {
        const sets = [{id: "conn", rules: [{actions: ["git:Push"]}]}, {id: "own", rules: [{actions: ["git:*"]}]}]
        expect((await decide(engine(), agent([{actions: ["git:Push"], level: "ask"}], sets), "git:Push")).context.approval).toBe("ask")
    })

    test("an ask applies only where its resources and conditions hold", async () => {
        const asks: GGAuthzAsk[] = [{actions: ["git:Push"], resources: [repo("prod")], level: "ask"}, {actions: ["git:Read"], conditions: [parent("agent:ws-ann")], level: "ask-once"}]
        expect((await decide(engine(), agent(asks), "git:Push", repo("prod"))).context.approval).toBe("ask")
        expect((await decide(engine(), agent(asks), "git:Push", repo("site"))).context.approval).toBe("auto")
        expect((await decide(engine(), agent(asks), "git:Read", repo("site"))).context.approval).toBe("ask-once")
        expect((await decide(engine(), agent(asks), "git:Read", repo("prod"))).context.approval).toBe("auto")
    })

    test("an ask with an unknown condition applies", async () => {
        const asks: GGAuthzAsk[] = [{actions: ["git:Push"], conditions: [{key: "resource.missing", op: "eq", value: "x"}], level: "ask"}, {actions: ["git:Read"], when: ["unknownFact"], level: "ask"}]
        expect((await decide(engine(), agent(asks), "git:Push")).context.approval).toBe("ask")
        expect((await decide(engine(), agent(asks), "git:Read")).context.approval).toBe("ask")
    })

    test("an ask never lowers a locked floor", async () => {
        const d = await decide(engine(), agent([{actions: ["git:Delete"], level: "ask-once"}]), "git:Delete")
        expect(d.context.approval).toBe("ask")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", source: "floor", locked: true}))
    })

    test("asks don't permit: an action outside every set is still denied, with no approval reason", async () => {
        const d = await decide(engine(), agent([{actions: ["git:Push"], level: "ask"}], [{id: "conn", rules: [{actions: ["git:Read"]}]}]), "git:Push")
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed", id: "conn"})])
    })

    test("humans get no level from asks", async () => {
        const d = await decide(engine(), {type: "user", id: "ann", properties: {asks: [{actions: ["git:*"], level: "critical"}]}}, "git:Push")
        expect(d.context.outcome).toBe("allow")
        expect(d.context.approval).toBeUndefined()
    })

    test("an ask can't be humans-only or auto: refusing is leaving the action out", () => {
        expect(IsGGAuthzAsk.is({actions: ["git:Push"], level: "humans-only"})).toBe(false)
        expect(IsGGAuthzAsk.is({actions: ["git:Push"], level: "auto"})).toBe(false)
        expect(IsGGAuthzAsk.is({actions: ["git:Push"], level: "dangerous"})).toBe(true)
    })
})

describe("the resource's level attribute raises too", () => {
    const authz = engine(undefined, {}, undefined, "approvalLevel")

    test("it raises auto", async () => {
        const d = await decide(authz, agent([]), "git:Read", repo("prod"))
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "critical"})
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "critical", source: "attribute"}))
    })

    test("it beats a lower ask; an absent attribute raises nothing", async () => {
        expect((await decide(authz, agent([{actions: ["git:Read"], level: "ask"}]), "git:Read", repo("prod"))).context.approval).toBe("critical")
        expect((await decide(authz, agent([]), "git:Read", repo("site"))).context.approval).toBe("auto")
    })

    test("a failed attribute load is an error, not a decision", async () => {
        const resolver = new GGAuthzMemoryResolver(data)
        vi.spyOn(resolver, "attributes").mockRejectedValue(new Error("store down"))
        await expect(decide(engine(undefined, {}, resolver, "approvalLevel"), agent([]), "git:Read")).rejects.toThrow("store down")
    })
})

describe("conditional floors", () => {
    const notOwnChild: GGAuthzFloorRule = {actions: ["git:Push"], conditions: [{key: "resource.parent", op: "ne", ref: "actor.key"}], level: "ask-once"}

    test("a conditional floor raises only where it holds", async () => {
        const authz = engine([notOwnChild])
        expect((await decide(authz, agent([]), "git:Push", repo("site"))).context.approval).toBe("auto")
        const d = await decide(authz, agent([]), "git:Push", repo("prod"))
        expect(d.context.approval).toBe("ask-once")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", source: "floor", locked: true}))
    })

    test("a floor whose `when` is known false doesn't apply", async () => {
        const authz = engine([{actions: ["git:Push"], when: ["foreign"], level: "ask"}])
        expect((await decide(authz, agent([]), "git:Push", repo("site"), {foreign: false})).context.approval).toBe("auto")
    })

    test("a conditional floor through defineAuthzModel", async () => {
        const Repo = defineAuthzService("floorgit", {types: {repo: ""}, actions: {Push: {on: ["repo"]}}})
        const defined = defineAuthzModel({partition: "acme", services: [Repo], roles: [], workloadTypes: ["agent"], approvalFloor: [{actions: [Repo.Push], when: ["foreign"], level: "ask"}]})
        const authz = new GGAuthz({model: defined, policies: {bindings: [{principal: "user:ann", role: "pusher", on: "rn:acme:floorgit:acme:repo/r"}], roles: [{name: "pusher", actions: [Repo.Push.name]}]}, resolver: new GGAuthzMemoryResolver({})})
        const push = (foreign: boolean) => authz.evaluate({subject: agent([]), action: {name: Repo.Push.name}, resource: {type: Repo.types.repo, id: "rn:acme:floorgit:acme:repo/r"}, context: {foreign}})
        expect((await push(true)).context.approval).toBe("ask")
        expect((await push(false)).context.approval).toBe("auto")
    })

    test("a floor with an unknown condition applies", async () => {
        const authz = engine([{actions: ["git:Push"], when: ["unknownFact"], level: "ask"}])
        expect((await decide(authz, agent([]), "git:Push")).context.approval).toBe("ask")
    })

    test("an ask raises past a conditional floor; neither lowers the other", async () => {
        const authz = engine([notOwnChild])
        expect((await decide(authz, agent([{actions: ["git:Push"], level: "critical"}]), "git:Push", repo("prod"))).context.approval).toBe("critical")
    })

    test("a humans-only floor is unconditional", () => {
        const base = model()
        expect(IsGGAuthzModel.is({...base, approvalFloor: [{actions: ["git:Push"], level: "humans-only"}]})).toBe(true)
        expect(IsGGAuthzModel.is({...base, approvalFloor: [{actions: ["git:Push"], level: "humans-only", when: ["x"]}]})).toBe(false)
        expect(IsGGAuthzModel.is({...base, approvalFloor: [{actions: ["git:Push"], level: "humans-only", conditions: [parent("x")]}]})).toBe(false)
    })
})
