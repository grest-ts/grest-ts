import {FORBIDDEN} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {GGAuthz, type GGAuthzConfig, GGAuthzMemoryResolver, type GGAuthzSubject} from "../src/index-node"
import {verdict} from "./util"
import {data, model, policies, rn, Secrets, Vm} from "./world"

const config: GGAuthzConfig = {model, policies, resolver: new GGAuthzMemoryResolver(data)}
const authz = new GGAuthz(config)

const ann: GGAuthzSubject = {type: "user", id: "ann"}
const agentForBen: GGAuthzSubject = {type: "agent", id: "ws-ben", properties: {onBehalfOf: {type: "user", id: "ben"}}}

describe("verdict: what a decision means for the caller", () => {
    test("an allow is allowed", async () => {
        expect(await verdict(authz, ann, Vm.StopWorkspace, rn.ws("ann-1"))).toEqual({outcome: "allowed"})
    })

    test("a denial is FORBIDDEN with the explanation as debug message", async () => {
        const v = await verdict(authz, ann, Vm.StopWorkspace, rn.ws("cleo-1"))
        expect(v.outcome === "denied" && [v.refusal, v.error.getDebugContext()?.debugMessage]).toEqual([
            "FORBIDDEN",
            "user:ann may not vm:StopWorkspace on rn:acme:vm:acme:workspace/cleo-1: No binding or resource policy grants it.",
        ])
        expect(v.outcome === "denied" && FORBIDDEN.is(v.error)).toBe(true)
    })

    test("a bad RN is a FORBIDDEN denial, not a crash", async () => {
        expect((await verdict(authz, ann, Vm.StopWorkspace, "not-an-rn")).outcome).toBe("denied")
    })

    test("an allow that needs approval says its level", async () => {
        expect(await verdict(authz, agentForBen, Secrets.Read, rn.secret("release-key"))).toEqual({outcome: "approval-required", level: "ask"})
    })

    test("context facts reach the conditions", async () => {
        const eve = {type: "user", id: "eve"}
        expect(await verdict(authz, eve, "git:Read", rn.repo("site"), {repoVisible: true})).toEqual({outcome: "allowed"})
        expect((await verdict(authz, eve, "git:Read", rn.repo("site"))).outcome).toBe("denied")
    })

    test("an action the model doesn't know is a programming error", async () => {
        await expect(verdict(authz, ann, "vm:Explode", rn.ws("ann-1"))).rejects.toThrow("Unknown action vm:Explode")
    })
})

test("an approval floor without workload types fails when the engine is built; tenant approvals don't", () => {
    const plain = {partition: "acme", actions: [{name: "docs:Read", resourceTypes: ["docs:doc"]}], roles: []}
    const resolver = new GGAuthzMemoryResolver({})
    expect(() => new GGAuthz({model: {...plain, approvalFloor: [{actions: ["docs:Read"], level: "ask" as const}]}, policies: {}, resolver})).toThrow("workloadTypes")
    const approvals = {resourcePolicies: [{on: "rn:acme:docs:acme:doc/d", approvals: [{actions: ["docs:Read"], level: "ask" as const}]}]}
    expect(() => new GGAuthz({model: plain, policies: approvals, resolver})).not.toThrow()
})
