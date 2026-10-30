import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzPolicies, type GGAuthzResolver, type GGAuthzSubject} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const repo = (id: string) => `rn:acme:git:acme:repo/${id}`

const model = {
    partition: "acme",
    actions: [{name: "git:Read", resourceTypes: ["git:repo"]}, {name: "git:Push", resourceTypes: ["git:repo"]}],
    roles: [{name: "writer", actions: ["git:*"]}],
    workloadTypes: ["agent", "client"],
}
const data = {parents: {[repo("site")]: org, [repo("api")]: org}}
const policies: GGAuthzPolicies = {
    bindings: [{principal: "user:ann", role: "writer", on: org}],
    resourcePolicies: [
        {on: org, approvals: [{actions: ["git:Push"], level: "ask"}]},
        {on: repo("api"), statements: [{effect: "deny", principals: ["client:untrusted"], actions: ["git:*"]}]},
    ],
    boundaries: [
        {id: "external-clients", principals: ["client:*"], allow: [{actions: ["git:Read", "git:Push"]}]},
        {id: "subagents", principals: ["agent:*"], allow: [{actions: ["git:Read"]}]},
    ],
}
const authz = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data)})

const chain = (via: string[], extra: Partial<NonNullable<GGAuthzSubject["properties"]>> = {}): GGAuthzSubject => ({
    type: "client", id: "mcp-app",
    properties: {onBehalfOf: {type: "user", id: "ann"}, via: via.map(v => ({type: v.split(":")[0]!, id: v.split(":")[1]!})), ...extra},
})
const evaluate = (subject: GGAuthzSubject, action: string, id: string) => authz.evaluate({subject, action: {name: action}, resource: {type: "git:repo", id}})

describe("delegation chains: an outside client calling through further agents", () => {
    test("allows still come from the human", async () => {
        expect((await evaluate(chain([]), "git:Push", repo("site"))).context.outcome).toBe("allow-with-approval")
    })

    test("every actor in the chain brings its boundaries", async () => {
        const d = await evaluate(chain(["agent:indexer"]), "git:Push", repo("site"))
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "boundary", kind: "ceiling-failed", id: "subagents"})])
        expect((await evaluate(chain(["agent:indexer"]), "git:Read", repo("site"))).decision).toBe(true)
    })

    test("a deny naming any actor in the chain applies", async () => {
        expect((await evaluate(chain([]), "git:Read", repo("api"))).decision).toBe(true)
        expect((await evaluate(chain(["client:untrusted"]), "git:Read", repo("api"))).context.reasons).toEqual([expect.objectContaining({layer: "deny"})])
    })

    test("approvals apply when any actor is a workload", async () => {
        const human: GGAuthzSubject = {type: "user", id: "ann", properties: {via: [{type: "agent", id: "indexer"}]}}
        expect((await evaluate(human, "git:Read", repo("site"))).context.audit).toBe(true)
    })
})

describe("restrictions: a per-request ceiling such as a token's authorization details", () => {
    test("nothing outside the restriction rules is possible", async () => {
        const only = chain([], {restrictions: [{actions: ["git:*"], resources: [`=${repo("site")}`]}]})
        expect((await evaluate(only, "git:Read", repo("site"))).decision).toBe(true)
        const d = await evaluate(only, "git:Read", repo("api"))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "restriction", kind: "ceiling-failed"})])
        expect(GGAuthz.explain({subject: only, action: {name: "git:Read"}, resource: {type: "git:repo", id: repo("api")}}, d)).toContain("request restriction")
    })

    test("restrictions never widen", async () => {
        const wide = {type: "user", id: "eve", properties: {restrictions: [{actions: ["git:*"]}]}}
        expect((await evaluate(wide, "git:Read", repo("site"))).decision).toBe(false)
    })

    test("listAllowed applies them as a required ceiling", async () => {
        const only = chain([], {restrictions: [{actions: ["git:Read"], resources: [`=${repo("site")}`]}]})
        const plan = await authz.listAllowed({subject: only, action: {name: "git:Read"}, resource: {type: "git:repo"}})
        expect(GGAuthz.applyPlan(plan, [repo("site"), repo("api")], {resolver: new GGAuthzMemoryResolver(data)})).toEqual([repo("site")])
    })
})

describe("async resolver", () => {
    const calls = {ancestors: 0, groups: 0}
    const remote: GGAuthzResolver = {
        ancestors: async rn => (calls.ancestors++, await Promise.resolve(rn === org ? [] : [org])),
        groups: async () => (calls.groups++, []),
    }
    const async = new GGAuthz({model, policies, resolver: remote})

    test("decisions match the in-memory resolver", async () => {
        const subject: GGAuthzSubject = {type: "user", id: "ann"}
        expect((await async.evaluate({subject, action: {name: "git:Push"}, resource: {type: "git:repo", id: repo("site")}})).decision).toBe(true)
    })

    test("a batch loads each resource chain and principal once", async () => {
        calls.ancestors = calls.groups = 0
        await async.evaluateBatch({
            subject: {type: "user", id: "ann"},
            evaluations: [
                {action: {name: "git:Read"}, resource: {type: "git:repo", id: repo("site")}},
                {action: {name: "git:Push"}, resource: {type: "git:repo", id: repo("site")}},
                {action: {name: "git:Read"}, resource: {type: "git:repo", id: repo("api")}},
            ],
        })
        expect(calls).toEqual({ancestors: 2, groups: 1})
    })

    test("a cyclic chain from the resolver is a request deny", async () => {
        const cyclic = new GGAuthz({model, policies, resolver: {ancestors: () => [org, repo("site")], groups: () => []}})
        const d = await cyclic.evaluate({subject: {type: "user", id: "ann"}, action: {name: "git:Read"}, resource: {type: "git:repo", id: repo("site")}})
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "request", kind: "invalid"})])
    })
})
