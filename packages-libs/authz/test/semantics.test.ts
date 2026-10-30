import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzPolicies, IsGGAuthzRnMatcher} from "../src/index-node"
import {req, subject} from "./util"
import {rn} from "./world"
import * as fixture from "./world"

const bucket = "rn:acme:store:acme:bucket/logs"
const object = "rn:acme:store:acme:bucket/logs/object/a"

const model = {
    partition: "acme",
    actions: [{name: "store:Read", resourceTypes: ["store:bucket", "store:object"]}, {name: "store:Write", resourceTypes: ["store:bucket", "store:object"]}],
    roles: [{name: "reader", actions: ["store:Read"]}, {name: "writer", actions: ["store:*"]}],
}

function engine(policies: GGAuthzPolicies) {
    return new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver({parents: {[object]: bucket}})})
}

describe("unknown facts fail closed in both directions", () => {
    const authz = engine({
        bindings: [{principal: "user:ann", role: "writer", on: bucket}, {principal: "user:ben", role: "reader", on: bucket, unless: ["suspended"]}],
        guardrails: [{id: "freeze", on: bucket, deny: [{actions: ["store:Write"], when: ["frozen"]}]}],
    })
    const may = async (principal: string, action: string, context?: Record<string, unknown>) => (await authz.evaluate(req(principal, action, object, {context}))).decision

    test("a deny applies when its fact is unknown, and only a known false lifts it", async () => {
        expect(await may("user:ann", "store:Write")).toBe(false)
        expect(await may("user:ann", "store:Write", {frozen: true})).toBe(false)
        expect(await may("user:ann", "store:Write", {frozen: false})).toBe(true)
    })

    test("an allow grants only when its facts are known", async () => {
        expect(await may("user:ben", "store:Read")).toBe(false)
        expect(await may("user:ben", "store:Read", {suspended: true})).toBe(false)
        expect(await may("user:ben", "store:Read", {suspended: false})).toBe(true)
    })

    test("a non-boolean context value is unknown", async () => {
        expect(await may("user:ann", "store:Write", {frozen: "no"})).toBe(false)
    })

    test("a plan excludes rows whose deny facts are unknown", async () => {
        const plan = await authz.listAllowed({subject: {type: "user", id: "ann"}, action: {name: "store:Write"}, resource: {type: "store:object"}})
        const resolver = new GGAuthzMemoryResolver({parents: {[object]: bucket}})
        expect(GGAuthz.applyPlan(plan, [object], {resolver, facts: () => undefined})).toEqual([])
        expect(GGAuthz.applyPlan(plan, [object], {resolver, facts: () => false})).toEqual([object])
    })
})

describe("on behalf of: each identity must clear a deny on its own", () => {
    const authz = new GGAuthz({model: fixture.model, policies: fixture.policies, resolver: new GGAuthzMemoryResolver(fixture.data)})
    const read = (actor: string, onBehalfOf?: string) => authz.evaluate({
        subject: subject(actor, onBehalfOf),
        action: {name: "secrets:Read"},
        resource: {type: "secrets:secret", id: rn.secret("release-key")},
    })

    test("an exempt workload doesn't carry a non-exempt human through", async () => {
        expect((await read("agent:release-bot")).decision).toBe(true)
        expect((await read("agent:release-bot", "user:ann")).context.reasons).toEqual([expect.objectContaining({layer: "deny", id: "release-key-only"})])
    })

    test("an exempt human's workload passes when the workload is exempt too", async () => {
        expect((await read("agent:ws-ben", "user:ben")).decision).toBe(true)
    })

    test("a deny that selects only workloads doesn't need the human exempted", async () => {
        const scoped = engine({
            bindings: [{principal: "user:ann", role: "reader", on: bucket}],
            resourcePolicies: [{on: bucket, statements: [{effect: "deny", principals: ["agent:*"], except: ["agent:indexer"], actions: ["store:Read"]}]}],
        })
        expect((await scoped.evaluate(req("agent:indexer", "store:Read", object, {for: "user:ann"}))).decision).toBe(true)
        expect((await scoped.evaluate(req("agent:other", "store:Read", object, {for: "user:ann"}))).decision).toBe(false)
    })
})

describe("exact resource matcher", () => {
    test("`=rn` matches the resource only; a plain RN also matches what's under it", async () => {
        const statement = (resources: string[]) => engine({resourcePolicies: [{on: bucket, statements: [{effect: "allow", principals: ["user:ann"], actions: ["store:Read"], resources}]}]})
        const exact = await statement([`=${bucket}`])
        expect((await exact.evaluate(req("user:ann", "store:Read", bucket))).decision).toBe(true)
        expect((await exact.evaluate(req("user:ann", "store:Read", object))).decision).toBe(false)
        expect((await statement([bucket]).evaluate(req("user:ann", "store:Read", object))).decision).toBe(true)
    })

    test("listAllowed carries the exact matcher as a residual", async () => {
        const authz = engine({resourcePolicies: [{on: bucket, statements: [{effect: "allow", principals: ["user:ann"], actions: ["store:Read"], resources: [`=${object}`]}]}]})
        const plan = await authz.listAllowed({subject: {type: "user", id: "ann"}, action: {name: "store:Read"}, resource: {type: "store:object"}})
        const other = "rn:acme:store:acme:bucket/logs/object/b"
        expect(GGAuthz.applyPlan(plan, [object, other], {resolver: new GGAuthzMemoryResolver({parents: {[object]: bucket, [other]: bucket}})})).toEqual([object])
    })

    test("the schema accepts `=` only in front of a valid RN", async () => {
        expect(IsGGAuthzRnMatcher.is(`=${bucket}`)).toBe(true)
        expect(IsGGAuthzRnMatcher.is("=nonsense")).toBe(false)
        expect(IsGGAuthzRnMatcher.is(`=${bucket}/*`)).toBe(false)
    })
})
