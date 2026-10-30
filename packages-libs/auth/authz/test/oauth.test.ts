import {FORBIDDEN} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzRequest, type GGAuthzSubject, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED} from "../src/index-node"
import {as} from "./util"
import {data, model, policies, rn, Secrets, Vm} from "./world"

const authz = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data)})

const client = (scopes: string[]): GGAuthzSubject => ({type: "client", id: "ci-tool", properties: {onBehalfOf: {type: "user", id: "ann"}, scopes}})
const user = (id: string): GGAuthzSubject => ({type: "user", id})
const request = (subject: GGAuthzSubject, action: {name: string}, resource: string, context?: Record<string, unknown>): GGAuthzRequest =>
    ({subject, action: {name: action.name}, resource: {type: resource.includes(":secrets:") ? "secrets:secret" : "vm:workspace", id: resource}, context})

describe("insufficient_scope: the token's scopes are the only thing in the way", () => {
    test("the decision names the scopes that would allow it", async () => {
        const decision = await authz.evaluate(request(client(["workspaces:read"]), Vm.StopWorkspace, rn.ws("ann-1")))
        expect(decision.decision).toBe(false)
        expect(decision.context.remedy).toEqual({scopes: ["workspaces:operate"]})
    })

    test("authorize throws INSUFFICIENT_SCOPE carrying them", async () => {
        const error = await as(client(["workspaces:read"]), () => authz.authorize(Vm.StopWorkspace, rn.ws("ann-1"))).catch(e => e)
        expect(INSUFFICIENT_SCOPE.is(error)).toBe(true)
        expect(error.data).toEqual({scopes: ["workspaces:operate"]})
        expect(error.getDebugContext().debugMessage).toContain("A token with scope workspaces:operate would be allowed.")
    })

    test("no remedy when the user couldn't do it with any scope", async () => {
        expect((await authz.evaluate(request(client(["workspaces:read"]), Vm.StopWorkspace, rn.ws("cleo-1")))).context.remedy).toBeUndefined()
    })

    test("no remedy when no scope covers the action", async () => {
        expect((await authz.evaluate(request(client(["workspaces:read"]), Vm.TakeOverWorkspace, rn.ws("ann-1")))).context.remedy).toBeUndefined()
    })

    test("no remedy when something other than scopes also blocks it", async () => {
        const agent: GGAuthzSubject = {type: "agent", id: "ws-ann", properties: {onBehalfOf: {type: "user", id: "ann"}, scopes: ["workspaces:read"]}}
        expect((await authz.evaluate(request(agent, Secrets.Write, rn.secret("signing")))).context.remedy).toBeUndefined()
    })
})

describe("step-up: re-authenticating would make the request allowed", () => {
    const secret = rn.wsSecret("ann-1", "env")

    test("a deny that holds because mfa is unknown or false names the step-up facts", async () => {
        expect((await authz.evaluate(request(user("ann"), Secrets.Write, secret))).context.remedy).toEqual({stepUp: ["mfa"]})
        expect((await authz.evaluate(request(user("ann"), Secrets.Write, secret, {mfa: false}))).context.remedy).toEqual({stepUp: ["mfa"]})
        expect((await authz.evaluate(request(user("ann"), Secrets.Write, secret, {mfa: true}))).decision).toBe(true)
    })

    test("authorize throws STEP_UP_REQUIRED (401) carrying them", async () => {
        const error = await as(user("ann"), () => authz.authorize(Secrets.Write, secret)).catch(e => e)
        expect(STEP_UP_REQUIRED.is(error)).toBe(true)
        expect(STEP_UP_REQUIRED.STATUS_CODE).toBe(401)
        expect(error.data).toEqual({facts: ["mfa"]})
        expect(error.getDebugContext().debugMessage).toContain("Allowed after step-up authentication (mfa).")
    })

    test("no step-up when re-authenticating wouldn't help", async () => {
        expect((await authz.evaluate(request(user("eve"), Secrets.Write, secret))).context.remedy).toBeUndefined()
        await expect(as(user("eve"), () => authz.authorize(Secrets.Write, secret))).rejects.toBeInstanceOf(FORBIDDEN)
    })

    test("no step-up unless the model declares the fact as one", async () => {
        const plain = new GGAuthz({model: {...model, stepUpFacts: undefined}, policies, resolver: new GGAuthzMemoryResolver(data)})
        expect((await plain.evaluate(request(user("ann"), Secrets.Write, secret))).context.remedy).toBeUndefined()
    })
})
