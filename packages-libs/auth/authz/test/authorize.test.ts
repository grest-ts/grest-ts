import {FORBIDDEN, NOT_AUTHORIZED} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {APPROVAL_REQUIRED, GGAuthz, type GGAuthzConfig, GGAuthzMemoryResolver, type GGAuthzSubject} from "../src/index-node"
import {as} from "./util"
import {data, model, policies, rn, Secrets, Vm} from "./world"

const config: GGAuthzConfig = {model, policies, resolver: new GGAuthzMemoryResolver(data)}
const authz = new GGAuthz(config)

const ann: GGAuthzSubject = {type: "user", id: "ann"}
const agentForBen: GGAuthzSubject = {type: "agent", id: "ws-ben", properties: {onBehalfOf: {type: "user", id: "ben"}}}

describe("authorize: the subject comes from context, failures throw", () => {
    test("allowed returns the decision", async () => {
        const decision = await as(ann, () => authz.authorize(Vm.StopWorkspace, rn.ws("ann-1")))
        expect(decision.context.outcome).toBe("allow")
    })

    test("denied throws FORBIDDEN with the explanation as debug message", async () => {
        const error = await as(ann, () => authz.authorize(Vm.StopWorkspace, rn.ws("cleo-1"))).catch(e => e)
        expect(FORBIDDEN.is(error)).toBe(true)
        expect(error.getDebugContext().debugMessage).toBe("user:ann may not vm:StopWorkspace on rn:acme:vm:acme:workspace/cleo-1: No binding or resource policy grants it.")
    })

    test("a bad RN is FORBIDDEN, not a crash", async () => {
        await expect(as(ann, () => authz.authorize(Vm.StopWorkspace, "not-an-rn"))).rejects.toBeInstanceOf(FORBIDDEN)
    })

    test("no subject in context throws NOT_AUTHORIZED", async () => {
        await expect(as(undefined, () => authz.authorize(Vm.StopWorkspace, rn.ws("ann-1")))).rejects.toBeInstanceOf(NOT_AUTHORIZED)
    })

    test("needs approval and none configured: APPROVAL_REQUIRED with the level", async () => {
        const error = await as(agentForBen, () => authz.authorize(Secrets.Read, rn.secret("release-key"))).catch(e => e)
        expect(APPROVAL_REQUIRED.is(error)).toBe(true)
        expect(error.data).toEqual({action: "secrets:Read", resource: rn.secret("release-key"), level: "ask"})
    })

    test("needs approval with a configured port: waits for it, its error propagates", async () => {
        const asked: string[] = []
        const approving = new GGAuthz({...config, approvals: async (request, decision) => void asked.push(`${request.action.name} ${decision.context.approval}`)})
        expect((await as(agentForBen, () => approving.authorize(Secrets.Read, rn.secret("release-key")))).context.outcome).toBe("allow-with-approval")
        expect(asked).toEqual(["secrets:Read ask"])

        const refusing = new GGAuthz({...config, approvals: async () => { throw new FORBIDDEN({debugMessage: "owner said no"}) }})
        await expect(as(agentForBen, () => refusing.authorize(Secrets.Read, rn.secret("release-key")))).rejects.toBeInstanceOf(FORBIDDEN)
    })

    test("context facts reach the conditions", async () => {
        const eve = {type: "user", id: "eve"}
        expect((await as(eve, () => authz.authorize("git:Read", rn.repo("site"), {repoVisible: true}))).decision).toBe(true)
        await expect(as(eve, () => authz.authorize("git:Read", rn.repo("site")))).rejects.toBeInstanceOf(FORBIDDEN)
    })

    test("an action the model doesn't know is a programming error", async () => {
        await expect(as(ann, () => authz.authorize("vm:Explode", rn.ws("ann-1")))).rejects.toThrow("Unknown action vm:Explode")
    })
})
