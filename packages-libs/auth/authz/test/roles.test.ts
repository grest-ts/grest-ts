import {FORBIDDEN} from "@grest-ts/schema"
import {describe, expect, test} from "vitest"
import {defineAuthzModel, defineAuthzRole, defineAuthzService, describeAuthzModel, GGAuthz, type GGAuthzBinding, GGAuthzMemoryResolver, type GGAuthzPolicies, type GGAuthzSubject} from "../src/index-node"
import {as} from "./util"

const org = "rn:acme:org:acme:org/acme"
const project = "rn:acme:org:acme:project/web"
const doc = "rn:acme:docs:acme:doc/plan"

const model = {
    partition: "acme",
    actions: [
        {name: "docs:Read", resourceTypes: ["docs:doc"]},
        {name: "docs:Write", resourceTypes: ["docs:doc"]},
        {name: "docs:Export", resourceTypes: ["docs:doc"]},
        {name: "org:ManageAccess", resourceTypes: ["org:org", "org:project"]},
    ],
    roles: [
        {name: "viewer", actions: ["docs:Read"]},
        {name: "editor", actions: ["docs:Write"], includes: ["viewer"]},
        {name: "access-manager", actions: ["org:ManageAccess"]},
        {name: "admin", actions: ["docs:*", "org:*"]},
    ],
    grantAction: "org:ManageAccess",
}
const resolver = new GGAuthzMemoryResolver({parents: {[project]: org, [doc]: project}})

const policies: GGAuthzPolicies = {
    roles: [{name: "auditor", actions: ["docs:Export"], includes: ["viewer"], description: "Reads and exports"}],
    bindings: [
        {principal: "user:root", role: "admin", on: org},
        {principal: "user:lead", role: "access-manager", on: project},
        {principal: "user:lead", role: "viewer", on: project},
        {principal: "user:ann", role: "auditor", on: project},
        {principal: "user:ben", role: "editor", on: project},
    ],
    boundaries: [{id: "agents", principals: ["agent:*"], allow: [{actions: ["docs:Read", "org:ManageAccess"]}]}],
}
const authz = new GGAuthz({model, policies, resolver})

const user = (id: string): GGAuthzSubject => ({type: "user", id})
const grant = (role: string, on = project): GGAuthzBinding => ({principal: "user:new", role, on})

describe("roles: inheritance and tenant-defined roles", () => {
    const may = async (id: string, action: string) => (await authz.evaluate({subject: user(id), action: {name: action}, resource: {type: "docs:doc", id: doc}})).decision

    test("an included role's actions come along", async () => {
        expect(await may("ben", "docs:Write")).toBe(true)
        expect(await may("ben", "docs:Read")).toBe(true)
        expect(await may("ben", "docs:Export")).toBe(false)
    })

    test("a tenant role works like a model role and can include one", async () => {
        expect(await may("ann", "docs:Export")).toBe(true)
        expect(await may("ann", "docs:Read")).toBe(true)
        expect(await may("ann", "docs:Write")).toBe(false)
    })

    test("bad role definitions fail when the engine is built", () => {
        const build = (extra: GGAuthzPolicies) => new GGAuthz({model, policies: extra, resolver})
        expect(() => build({roles: [{name: "viewer", actions: []}]})).toThrow("already defined by the model")
        expect(() => build({roles: [{name: "a", includes: ["b"]}, {name: "b", includes: ["a"]}]})).toThrow("cycle")
        expect(() => build({roles: [{name: "a", includes: ["ghost"]}]})).toThrow("Unknown role ghost (included by a)")
        expect(() => build({roles: [{name: "a", actions: ["docs:Fly"]}]})).toThrow("Unknown action docs:Fly")
    })

    test("define functions accept includes", () => {
        const roles = [defineAuthzRole("t-viewer", {actions: ["docs:Read"]})]
        roles.push(defineAuthzRole("t-editor", {actions: ["docs:Write"], includes: [roles[0]!]}))
        const defined = defineAuthzModel({partition: "acme", services: [defineAuthzService("docs", {types: {doc: ""}, actions: {Read: {on: ["doc"]}, Write: {on: ["doc"]}}})], roles})
        expect(describeAuthzModel(defined).roles.find(r => r.name === "t-editor")!.actions).toEqual(["docs:Write", "docs:Read"])
    })
})

describe("canGrant: the grant action, and no escalation", () => {
    test("an admin on the org may grant any role on a project", async () => {
        expect((await authz.canGrant({subject: user("root"), binding: grant("editor")})).decision).toBe(true)
        expect((await authz.canGrant({subject: user("root"), binding: grant("auditor")})).decision).toBe(true)
        const lenient = new GGAuthz({model: {...model, grantAction: undefined}, policies, resolver})
        const d = await lenient.canGrant({subject: user("ben"), binding: grant("viewer")})
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "grant", kind: "binding", role: "viewer"})])
    })

    test("managing access isn't enough: the grantor must hold the role's actions there", async () => {
        expect((await authz.canGrant({subject: user("lead"), binding: grant("viewer")})).decision).toBe(true)
        const d = await authz.canGrant({subject: user("lead"), binding: grant("editor")})
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "grant", kind: "escalation", role: "editor", actions: ["docs:Write"]})])
    })

    test("holding the actions isn't enough without the grant action", async () => {
        const d = await authz.canGrant({subject: user("ben"), binding: grant("viewer")})
        expect(d.decision).toBe(false)
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "default", kind: "no-grant"})])
    })

    test("an agent can't grant past its boundary, even for an admin", async () => {
        const agent: GGAuthzSubject = {type: "agent", id: "helper", properties: {onBehalfOf: {type: "user", id: "root"}}}
        expect((await authz.canGrant({subject: agent, binding: grant("viewer")})).decision).toBe(true)
        expect((await authz.canGrant({subject: agent, binding: grant("editor")})).context.reasons).toEqual([expect.objectContaining({kind: "escalation", actions: ["docs:Write"]})])
    })

    test("a deny undecided only for want of a resource attribute doesn't block holding an action", async () => {
        const guarded = (deny: GGAuthzPolicies["guardrails"]) => new GGAuthz({model, policies: {...policies, guardrails: deny}, resolver})
        const ownerOnly = guarded([{id: "owner-only", on: org, deny: [{actions: ["docs:Write"], conditions: [{key: "resource.owner", op: "ne", ref: "principal.key"}]}]}])
        expect((await ownerOnly.canGrant({subject: user("root"), binding: grant("editor")})).decision).toBe(true)
        const always = guarded([{id: "no-writes", on: org, deny: [{actions: ["docs:Write"]}]}])
        expect((await always.canGrant({subject: user("root"), binding: grant("editor")})).context.reasons).toEqual([expect.objectContaining({kind: "escalation", actions: ["docs:Write"]})])
    })

    // A grantor denied an action can't hand it out because the deny hinged on something about them it couldn't see.
    test("a deny undecided on a principal attribute or a missing fact still blocks it (fail closed)", async () => {
        const guarded = (deny: GGAuthzPolicies["guardrails"]) => new GGAuthz({model, policies: {...policies, guardrails: deny}, resolver})
        const clearance = guarded([{id: "clearance", on: org, deny: [{actions: ["docs:Write"], conditions: [{key: "principal.clearance", op: "lt", value: 3}]}]}])
        expect((await clearance.canGrant({subject: user("root"), binding: grant("editor")})).decision).toBe(false)
        expect(await clearance.missingActions({subject: user("root"), actions: ["docs:Write"], on: project})).toEqual(["docs:Write"])
        const cleared = new GGAuthz({model, policies: {...policies, guardrails: [{id: "clearance", on: org, deny: [{actions: ["docs:Write"], conditions: [{key: "principal.clearance", op: "lt", value: 3}]}]}]},
            resolver: new GGAuthzMemoryResolver({parents: {[project]: org, [doc]: project}, attributes: {"user:root": {clearance: 5}}})})
        expect((await cleared.canGrant({subject: user("root"), binding: grant("editor")})).decision).toBe(true)

        const mfa = guarded([{id: "mfa", on: org, deny: [{actions: ["docs:Write"], unless: ["mfa"]}]}])
        expect((await mfa.canGrant({subject: user("root"), binding: grant("editor")})).decision).toBe(false)
        expect((await mfa.canGrant({subject: user("root"), binding: grant("editor"), context: {mfa: true}})).decision).toBe(true)
    })

    test("missingActions: what the subject doesn't hold on a scope, skipping unknown actions", async () => {
        expect(await authz.missingActions({subject: user("lead"), actions: ["docs:Read", "docs:Write", "ghost:Fly"], on: project})).toEqual(["docs:Write"])
        expect(await authz.missingActions({subject: user("root"), actions: ["docs:Write"], on: project})).toEqual([])
        expect(await authz.missingActions({subject: user("root"), actions: ["docs:Write"], on: "rn:other:org:x:project/p"})).toBeUndefined()
    })

    test("unknown roles and foreign scopes are denials, not errors", async () => {
        expect((await authz.canGrant({subject: user("root"), binding: grant("ghost")})).context.reasons).toEqual([expect.objectContaining({kind: "invalid"})])
        expect((await authz.canGrant({subject: user("root"), binding: grant("viewer", "rn:other:org:x:project/p")})).context.reasons).toEqual([expect.objectContaining({kind: "invalid"})])
    })

    test("authorizeGrant throws FORBIDDEN for the subject in context", async () => {
        const grantAs = (id: string) => as(user(id), () => authz.authorizeGrant(grant("editor")))
        expect((await grantAs("root")).decision).toBe(true)
        const error = await grantAs("lead").catch(e => e)
        expect(FORBIDDEN.is(error)).toBe(true)
        expect(error.getDebugContext().debugMessage).toContain("granting role editor on rn:acme:org:acme:project/web needs docs:Write")
    })
})
