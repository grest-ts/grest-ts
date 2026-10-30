import {describe, expect, test} from "vitest"
import {GGAuthz, GGAuthzMemoryResolver, type GGAuthzPolicies} from "../src/index-node"
import {req} from "./util"

const org = "rn:acme:org:acme:org/acme"
const doc = "rn:acme:docs:acme:doc/plan"

const model = {
    partition: "acme",
    actions: [
        {name: "docs:Read", resourceTypes: ["docs:doc"]},
        {name: "docs:Write", resourceTypes: ["docs:doc"]},
    ],
    roles: [{name: "reader", actions: ["docs:Read"]}],
}
const resolver = new GGAuthzMemoryResolver({parents: {[doc]: org}})

// `sites` was a module that is no longer installed.
const policies: GGAuthzPolicies = {
    roles: [{name: "publisher", actions: ["docs:Write", "sites:Publish", "sites:*"]}],
    bindings: [{principal: "user:ann", role: "publisher", on: org}, {principal: "user:ben", role: "reader", on: org}],
    resourcePolicies: [{
        on: doc,
        statements: [{sid: "ben-sites", effect: "deny", principals: ["user:ben"], actions: ["sites:Publish", "docs:Read"]}],
        approvals: [{actions: ["sites:Publish"], level: "ask"}],
    }],
    boundaries: [{id: "agents", principals: ["agent:*"], allow: [{actions: ["sites:*"]}]}],
    guardrails: [{id: "freeze", on: org, deny: [{actions: ["sites:Publish"]}]}],
}

const ask = (key: string, action: string) => req(key, action, doc, {for: key.startsWith("agent:") ? "user:ann" : undefined})

describe("unknownActions", () => {

    test("throws by default, so a typo can't silently grant nothing", () => {
        expect(() => new GGAuthz({model, policies, resolver})).toThrow("Unknown action sites:Publish")
    })

    test("ignore skips them and lists every place they were", () => {
        const authz = new GGAuthz({model, policies, resolver, unknownActions: "ignore"})
        expect(authz.inactive).toEqual([
            {source: "role publisher", action: "sites:Publish"},
            {source: "role publisher", action: "sites:*"},
            {source: `policy ${doc} ben-sites`, action: "sites:Publish"},
            {source: `approvals ${doc}`, action: "sites:Publish"},
            {source: "guardrail freeze", action: "sites:Publish"},
            {source: "boundary agents", action: "sites:*"},
        ])
    })

    test("the known rest of each rule still applies", async () => {
        const authz = new GGAuthz({model, policies, resolver, unknownActions: "ignore"})
        expect((await authz.evaluate(ask("user:ann", "docs:Write"))).decision).toBe(true)
        expect((await authz.evaluate(ask("user:ben", "docs:Read"))).decision).toBe(false)
    })

    test("a ceiling left with only unknown actions caps everything", async () => {
        const authz = new GGAuthz({model, policies, resolver, unknownActions: "ignore"})
        expect((await authz.evaluate(ask("agent:ws-ann", "docs:Write"))).decision).toBe(false)
    })

    test("model roles stay strict", () => {
        const broken = {...model, roles: [{name: "reader", actions: ["sites:Publish"]}]}
        expect(() => new GGAuthz({model: broken, policies: {}, resolver, unknownActions: "ignore"})).toThrow("Unknown action sites:Publish")
    })
})
