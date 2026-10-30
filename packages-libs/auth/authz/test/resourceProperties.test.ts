import {describe, expect, test} from "vitest"
import {GGAuthz, type GGAuthzRequest} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const project = "rn:acme:org:acme:project/web"
const ws = "rn:acme:vm:acme:workspace/w1"

const model = {
    partition: "acme",
    actions: [{name: "vm:Stop", resourceTypes: ["vm:workspace"]}],
    roles: [{name: "operator", actions: ["vm:Stop"]}],
}
// Knows nothing: every ancestor and attribute must come from the request.
const resolver = {ancestors: () => [], groups: () => [], attributes: () => undefined}

const stop = (properties?: NonNullable<GGAuthzRequest["resource"]["properties"]>): GGAuthzRequest =>
    ({subject: {type: "user", id: "ann"}, action: {name: "vm:Stop"}, resource: {type: "vm:workspace", id: ws, properties}})

describe("resource properties from the caller's row", () => {

    test("ancestors put the resource under a binding the resolver can't see", async () => {
        const authz = new GGAuthz({model, policies: {bindings: [{principal: "user:ann", role: "operator", on: project}]}, resolver})
        expect((await authz.evaluate(stop())).decision).toBe(false)
        expect((await authz.evaluate(stop({ancestors: [project, org]}))).decision).toBe(true)
    })

    test("attributes feed resource conditions", async () => {
        const policies = {bindings: [{principal: "everyone", role: "operator", on: org, conditions: [{key: "resource.owner", op: "eq" as const, ref: "principal.key"}]}]}
        const authz = new GGAuthz({model, policies, resolver})
        expect((await authz.evaluate(stop({ancestors: [org], attributes: {owner: "user:ann"}}))).decision).toBe(true)
        expect((await authz.evaluate(stop({ancestors: [org], attributes: {owner: "user:ben"}}))).decision).toBe(false)
    })

    test("a cyclic ancestor list is an invalid request", async () => {
        const authz = new GGAuthz({model, policies: {}, resolver})
        expect((await authz.evaluate(stop({ancestors: [org, ws]}))).context.reasons[0]).toMatchObject({layer: "request", kind: "invalid"})
    })
})
