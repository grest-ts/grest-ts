import {describe, expect, test} from "vitest"
import {GGAuthz, type GGAuthzRequest} from "../src/index-node"

const org = "rn:acme:org:acme:org/acme"
const project = "rn:acme:org:acme:project/web"
const ws = "rn:acme:vm:acme:workspace/w1"

const model = {
    partition: "acme",
    tenantType: "org:org",
    types: [{name: "org:org"}, {name: "org:project"}, {name: "vm:workspace", parents: ["org:project"]}],
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
        expect((await authz.evaluate(stop({ancestors: [project, org], attributes: {owner: "user:ann"}}))).decision).toBe(true)
        expect((await authz.evaluate(stop({ancestors: [project, org], attributes: {owner: "user:ben"}}))).decision).toBe(false)
    })

    test("a cyclic ancestor list is an invalid request", async () => {
        const authz = new GGAuthz({model, policies: {}, resolver})
        expect((await authz.evaluate(stop({ancestors: [org, ws]}))).context.reasons[0]).toMatchObject({layer: "request", kind: "invalid"})
    })
})

describe("the scope chain is a path the model's types allow", () => {
    const authz = new GGAuthz({model, policies: {bindings: [{principal: "user:ann", role: "operator", on: org}]}, resolver})
    const reason = async (request: GGAuthzRequest, engine = authz) => (await engine.evaluate(request)).context.reasons[0]
    const invalid = (message: string) => ({layer: "request", kind: "invalid", message: `Scope chain of ${ws} ${message}`})

    test("a chain through the declared parents to the tenant root decides", async () => {
        expect((await authz.evaluate(stop({ancestors: [project, org]}))).decision).toBe(true)
    })

    test("a missing ancestor, a parent of the wrong type or a chain short of the root is invalid, never an allow", async () => {
        expect(await reason(stop({ancestors: [org]}))).toEqual(invalid("puts vm:workspace in org:org, which the model doesn't allow"))
        expect(await reason(stop({ancestors: ["rn:acme:vm:acme:workspace/w0", project, org]}))).toEqual(invalid("puts vm:workspace in vm:workspace, which the model doesn't allow"))
        expect(await reason(stop({ancestors: [project]}))).toEqual(invalid("ends at rn:acme:org:acme:project/web, not at the tenant root org:org acme"))
        expect(await reason(stop({ancestors: [project, "rn:acme:org:acme:org/other"]}))).toEqual(invalid("ends at rn:acme:org:acme:org/other, not at the tenant root org:org acme"))
        expect(await reason(stop({ancestors: []}))).toEqual(invalid("ends at rn:acme:vm:acme:workspace/w1, not at the tenant root org:org acme"))
    })

    test("an ancestor in another tenant or partition is invalid", async () => {
        expect(await reason(stop({ancestors: ["rn:acme:org:evil:project/web", "rn:acme:org:evil:org/evil"]}))).toEqual(invalid("leaves tenant acme at rn:acme:org:evil:project/web"))
        expect(await reason(stop({ancestors: ["rn:other:org:acme:project/web", org]}))).toEqual(invalid("has rn:other:org:acme:project/web, not a resource name in partition acme"))
    })

    test("the resolver's chains are checked the same", async () => {
        const flat = new GGAuthz({model, policies: {bindings: [{principal: "user:ann", role: "operator", on: org}]}, resolver: {...resolver, ancestors: () => [org]}})
        expect(await reason(stop(), flat)).toEqual(invalid("puts vm:workspace in org:org, which the model doesn't allow"))
        expect(await flat.missingActions({subject: {type: "user", id: "ann"}, actions: ["vm:Stop"], on: ws})).toBeUndefined()
    })
})

describe("the actor's attributes from the request", () => {

    test("feed actor conditions, so the resolver isn't asked", async () => {
        const policies = {bindings: [{principal: "everyone", role: "operator", on: org, conditions: [{key: "actor.project", op: "eq" as const, value: "web"}]}]}
        const authz = new GGAuthz({model, policies, resolver})
        const asActor = (attributes?: Record<string, unknown>): GGAuthzRequest => ({...stop({ancestors: [project, org]}), subject: {type: "user", id: "ann", properties: {attributes}}})
        expect((await authz.evaluate(asActor({project: "web"}))).decision).toBe(true)
        expect((await authz.evaluate(asActor({project: "api"}))).decision).toBe(false)
        expect((await authz.evaluate(asActor())).decision).toBe(false)
    })

    test("are the principal's too when it acts for itself", async () => {
        const policies = {bindings: [{principal: "everyone", role: "operator", on: org, conditions: [{key: "principal.project", op: "eq" as const, value: "web"}]}]}
        const authz = new GGAuthz({model, policies, resolver})
        const asSelf = (attributes: Record<string, unknown>): GGAuthzRequest => ({...stop({ancestors: [project, org]}), subject: {type: "user", id: "ann", properties: {attributes}}})
        expect((await authz.evaluate(asSelf({project: "web"}))).decision).toBe(true)
        expect((await authz.evaluate(asSelf({project: "api"}))).decision).toBe(false)
    })
})
