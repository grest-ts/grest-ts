import {describe, expect, test} from "vitest"
import {GGAuthz, type GGAuthzCondition, GGAuthzMemoryResolver, type GGAuthzPolicies, IsGGAuthzCondition, IsGGAuthzPolicies} from "../src/index-node"

const bucket = "rn:acme:store:acme:bucket/logs"
const doc = (id: string) => `${bucket}/object/${id}`

const model = {
    partition: "acme",
    actions: [{name: "store:Read", resourceTypes: ["store:object"]}, {name: "store:Delete", resourceTypes: ["store:object"]}],
    roles: [{name: "reader", actions: ["store:Read"]}, {name: "admin", actions: ["store:*"]}],
}
const resolver = new GGAuthzMemoryResolver({
    parents: {[doc("a")]: bucket, [doc("b")]: bucket, [doc("c")]: bucket},
    attributes: {
        "user:ann": {team: "red", level: 2},
        "user:ben": {team: "blue"},
        [doc("a")]: {owner: "user:ann", team: "red", level: 1, tags: ["public"]},
        [doc("b")]: {owner: "user:ben", team: "blue", level: 3},
        [doc("c")]: {},
    },
})

function engine(policies: GGAuthzPolicies) {
    const authz = new GGAuthz({model, policies, resolver})
    const may = async (user: string, action: string, id: string, context?: Record<string, unknown>) =>
        (await authz.evaluate({subject: {type: "user", id: user}, action: {name: action}, resource: {type: "store:object", id: doc(id)}, context})).decision
    return {authz, may}
}

const allowIf = (conditions: GGAuthzCondition[]): GGAuthzPolicies => ({
    resourcePolicies: [{on: bucket, statements: [{effect: "allow", principals: ["user:*"], actions: ["store:Read"], conditions}]}],
})

describe("attribute conditions", () => {
    test("the owner pattern compares a resource attribute with the principal", async () => {
        const {may} = engine(allowIf([{key: "resource.owner", op: "eq", ref: "principal.key"}]))
        expect(await may("ann", "store:Read", "a")).toBe(true)
        expect(await may("ann", "store:Read", "b")).toBe(false)
        expect(await may("ben", "store:Read", "b")).toBe(true)
    })

    test("principal and resource attributes compare with each other", async () => {
        const {may} = engine(allowIf([{key: "resource.team", op: "eq", ref: "principal.team"}]))
        expect(await may("ann", "store:Read", "a")).toBe(true)
        expect(await may("ann", "store:Read", "b")).toBe(false)
    })

    test("operators: numbers, sets, prefixes, presence", async () => {
        expect(await engine(allowIf([{key: "resource.level", op: "le", ref: "principal.level"}])).may("ann", "store:Read", "a")).toBe(true)
        expect(await engine(allowIf([{key: "resource.level", op: "le", ref: "principal.level"}])).may("ann", "store:Read", "b")).toBe(false)
        expect(await engine(allowIf([{key: "resource.tags", op: "contains", value: "public"}])).may("ben", "store:Read", "a")).toBe(true)
        expect(await engine(allowIf([{key: "resource.team", op: "in", value: ["red", "green"]}])).may("ben", "store:Read", "a")).toBe(true)
        expect(await engine(allowIf([{key: "resource.rn", op: "startsWith", value: bucket}])).may("ben", "store:Read", "c")).toBe(true)
        expect(await engine(allowIf([{key: "resource.owner", op: "present", value: false}])).may("ben", "store:Read", "c")).toBe(true)
    })

    test("request context values", async () => {
        const {may} = engine(allowIf([{key: "context.ip", op: "startsWith", value: "10."}]))
        expect(await may("ben", "store:Read", "c", {ip: "10.0.0.7"})).toBe(true)
        expect(await may("ben", "store:Read", "c", {ip: "192.168.0.1"})).toBe(false)
    })

    test("a missing attribute is unknown: an allow doesn't grant, a deny applies", async () => {
        expect(await engine(allowIf([{key: "resource.team", op: "ne", value: "blue"}])).may("ann", "store:Read", "c")).toBe(false)
        const {may} = engine({
            bindings: [{principal: "user:ann", role: "admin", on: bucket}],
            resourcePolicies: [{on: bucket, statements: [{effect: "deny", principals: ["everyone"], actions: ["store:Delete"], conditions: [{key: "resource.level", op: "ge", value: 3}]}]}],
        })
        expect(await may("ann", "store:Delete", "a")).toBe(true)
        expect(await may("ann", "store:Delete", "b")).toBe(false)
        expect(await may("ann", "store:Delete", "c")).toBe(false)
    })

    test("a value of the wrong type for the operator is unknown", async () => {
        expect(await engine(allowIf([{key: "resource.team", op: "lt", value: 3}])).may("ann", "store:Read", "a")).toBe(false)
    })

    test("conditions on a binding", async () => {
        const {may} = engine({bindings: [{principal: "user:ann", role: "reader", on: bucket, conditions: [{key: "resource.team", op: "eq", ref: "principal.team"}]}]})
        expect(await may("ann", "store:Read", "a")).toBe(true)
        expect(await may("ann", "store:Read", "b")).toBe(false)
    })

    test("attributes are loaded only when a policy uses them", async () => {
        let calls = 0
        const counting = {ancestors: (rn: string) => resolver.ancestors(rn), groups: () => [], attributes: () => (calls++, undefined)}
        const plain = new GGAuthz({model, policies: {bindings: [{principal: "user:ann", role: "reader", on: bucket}]}, resolver: counting})
        await plain.evaluate({subject: {type: "user", id: "ann"}, action: {name: "store:Read"}, resource: {type: "store:object", id: doc("a")}})
        expect(calls).toBe(0)
    })

    test("listAllowed keeps row conditions as residuals with the principal's values filled in", async () => {
        const {authz} = engine(allowIf([{key: "resource.team", op: "eq", ref: "principal.team"}, {key: "principal.level", op: "ge", value: 1}]))
        const plan = await authz.listAllowed({subject: {type: "user", id: "ann"}, action: {name: "store:Read"}, resource: {type: "store:object"}})
        expect(plan.include).toEqual([{within: bucket, conditions: [{key: "resource.team", op: "eq", ref: "principal.team"}]}])
        expect(plan.values).toEqual({"principal.team": "red"})
        expect(GGAuthz.applyPlan(plan, [doc("a"), doc("b"), doc("c")], {resolver})).toEqual([doc("a")])
        const ben = await authz.listAllowed({subject: {type: "user", id: "ben"}, action: {name: "store:Read"}, resource: {type: "store:object"}})
        expect(ben.include).toEqual([])
    })

    test("the schema rejects malformed conditions", () => {
        expect(IsGGAuthzCondition.is({key: "resource.team", op: "eq", value: "red"})).toBe(true)
        expect(IsGGAuthzCondition.is({key: "resource.team", op: "eq"})).toBe(false)
        expect(IsGGAuthzCondition.is({key: "resource.team", op: "eq", value: "red", ref: "principal.team"})).toBe(false)
        expect(IsGGAuthzCondition.is({key: "resource.team", op: "in", value: "red"})).toBe(false)
        expect(IsGGAuthzCondition.is({key: "resource.team", op: "present", value: "yes"})).toBe(false)
        expect(IsGGAuthzCondition.is({key: "team", op: "eq", value: "red"})).toBe(false)
        expect(() => IsGGAuthzPolicies.parse(allowIf([{key: "resource.team", op: "in", value: "red"} as never]))).toThrow()
    })
})
