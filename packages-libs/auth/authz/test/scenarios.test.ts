import {describe, expect, test} from "vitest"
import {type GGAuthzRequest, GGAuthz, GGAuthzMemoryResolver, IsGGAuthzDecision, IsGGAuthzRequest} from "../src/index-node"
import {req} from "./util"
import {data, model, policies, rn} from "./world"

const authz = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data)})

async function check(request: GGAuthzRequest) {
    const decision = await authz.evaluate(request)
    expect(IsGGAuthzDecision.is(decision)).toBe(true)
    expect(decision.context.reasons.length).toBeGreaterThan(0)
    return decision
}

describe("member launching on a GPU cloud only via a group role", () => {
    test("gpu-users member may launch", async () => {
        const d = await check(req("user:ben", "cloud:Launch", rn.cloud("gpu")))
        expect(d.context.outcome).toBe("allow")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({kind: "binding", principal: "group:gpu-users", role: "gpu-launcher", on: rn.cloud("gpu")}))
    })
    test("a member outside the group may not, but may use the basic cloud everyone can", async () => {
        expect((await check(req("user:ann", "cloud:Launch", rn.cloud("gpu")))).context.reasons).toEqual([expect.objectContaining({layer: "default", kind: "no-grant"})])
        expect((await check(req("user:ann", "cloud:Launch", rn.cloud("basic")))).context.reasons).toContainEqual(expect.objectContaining({principal: "everyone"}))
    })
})

describe("agent reading a release secret under the agent boundary", () => {
    test("agent acting for the secret's reader needs `ask` approval", async () => {
        const d = await check(req("agent:ws-ben", "secrets:Read", rn.secret("release-key"), {for: "user:ben"}))
        expect(d.decision).toBe(true)
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "ask", audit: true})
        expect(d.context.reasons).toContainEqual(expect.objectContaining({kind: "statement", id: "ben-reads-release-key"}))
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "boundary", kind: "ceiling-passed", id: "agents", actions: ["secrets:Read"]}))
    })
    test("the human needs no approval", async () => {
        const d = await check(req("user:ben", "secrets:Read", rn.secret("release-key")))
        expect(d.context.outcome).toBe("allow")
        expect(d.context.approval).toBeUndefined()
    })
    test("agent acting for someone the secret excludes is denied by its resource policy", async () => {
        const d = await check(req("agent:ws-ann", "secrets:Read", rn.secret("release-key"), {for: "user:ann"}))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "deny", id: "release-key-only"})])
    })
    test("the boundary caps what the agent may do even when the human may", async () => {
        const d = await check(req("agent:ws-ann", "org:ManageMembers", rn.web, {for: "user:cleo"}))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "boundary", kind: "ceiling-failed", id: "agents"})])
        expect((await check(req("user:cleo", "org:ManageMembers", rn.web))).decision).toBe(true)
    })
    test("an agent's own bindings don't count when it acts for a human", async () => {
        expect((await check(req("agent:release-bot", "secrets:Read", rn.secret("db-pass")))).decision).toBe(true)
        expect((await check(req("agent:release-bot", "secrets:Read", rn.secret("db-pass"), {for: "user:eve"}))).decision).toBe(false)
    })
})

describe("contractor denied a paid resource by a guardrail", () => {
    test("guardrail beats the group role", async () => {
        const d = await check(req("user:dan", "cloud:Launch", rn.cloud("gpu")))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "guardrail", kind: "denied", id: "contractors-no-paid", on: rn.org})])
    })
    test("the free cloud is still fine", async () => {
        expect((await check(req("user:dan", "cloud:Launch", rn.cloud("basic")))).decision).toBe(true)
    })
})

describe("admin taking over another user's workspace", () => {
    test("admin role on the org reaches every workspace", async () => {
        const d = await check(req("user:cleo", "vm:TakeOverWorkspace", rn.ws("ann-1")))
        expect(d.context.outcome).toBe("allow")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({principal: "group:admins", role: "admin", on: rn.org}))
    })
    test("a peer may not", async () => {
        expect((await check(req("user:ben", "vm:TakeOverWorkspace", rn.ws("ann-1")))).decision).toBe(false)
    })
    test("an agent acting for the admin hits the locked humans-only level", async () => {
        const d = await check(req("agent:ws-ben", "vm:TakeOverWorkspace", rn.ws("ann-1"), {for: "user:cleo"}))
        expect(d.context.reasons).toEqual([expect.objectContaining({layer: "approval", level: "humans-only", on: rn.ws("ann-1"), locked: true})])
    })
})

describe("OAuth-like client whose token scopes narrow access", () => {
    const stop = (scopes: string[]) => check(req("client:ci-tool", "vm:StopWorkspace", rn.ws("ann-1"), {for: "user:ann", scopes}))
    test("read-only scope can't stop what the user could", async () => {
        expect((await check(req("user:ann", "vm:StopWorkspace", rn.ws("ann-1")))).decision).toBe(true)
        expect((await stop(["workspaces:read"])).context.reasons).toEqual([expect.objectContaining({layer: "scope", kind: "ceiling-failed"})])
    })
    test("operate scope can", async () => {
        const d = await stop(["workspaces:read", "workspaces:operate"])
        expect(d.context.outcome).toBe("allow")
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "scope", kind: "ceiling-passed", id: "workspaces:operate"}))
    })
    test("scopes never widen access", async () => {
        expect((await check(req("client:ci-tool", "vm:StopWorkspace", rn.ws("cleo-1"), {for: "user:ann", scopes: ["workspaces:operate"]}))).decision).toBe(false)
    })
    test("an empty or unknown scope list allows nothing", async () => {
        expect((await stop([])).decision).toBe(false)
        expect((await stop(["nope"])).decision).toBe(false)
    })
})

describe("secret approval levels with a locked minimum on the project", () => {
    const read = (secret: string) => check(req("agent:release-bot", "secrets:Read", secret))
    test("a secret can't lower the project's locked `ask` to `auto`", async () => {
        const d = await read(rn.secret("db-pass"))
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "ask"})
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", level: "ask", on: rn.web, locked: true, lowered: {on: rn.secret("db-pass"), level: "auto"}}))
    })
    test("a secret may raise it", async () => {
        expect((await read(rn.secret("signing"))).context).toMatchObject({approval: "critical"})
    })
    test("unlocked levels can be lowered by a descendant", async () => {
        expect((await check(req("agent:ws-ann", "vm:StopWorkspace", rn.ws("ann-1"), {for: "user:ann"}))).context).toMatchObject({outcome: "allow-with-approval", approval: "ask-once"})
        expect((await check(req("agent:ws-ann", "vm:StopWorkspace", rn.ws("cleo-1"), {for: "user:cleo"}))).context).toMatchObject({outcome: "allow", approval: "auto", audit: true})
    })
    test("platform floor applies with no policy at all", async () => {
        const d = await check(req("agent:ws-ann", "secrets:Write", rn.wsSecret("dan-1", "env"), {for: "user:dan", context: {mfa: true}}))
        expect(d.context).toMatchObject({outcome: "allow-with-approval", approval: "ask"})
        expect(d.context.reasons).toContainEqual(expect.objectContaining({layer: "approval", message: "platform floor", locked: true}))
    })
    test("humans-only shuts out agents, and a descendant may lower an unlocked one", async () => {
        expect((await check(req("agent:ws-ann", "cloud:Launch", rn.cloud("basic"), {for: "user:ann"}))).context.reasons).toEqual([expect.objectContaining({layer: "approval", level: "humans-only", on: rn.org, locked: false})])
        expect((await check(req("agent:ws-ann", "cloud:Launch", rn.cloud("ml-gpu"), {for: "user:dan"}))).context).toMatchObject({outcome: "allow-with-approval", approval: "ask"})
    })
})

describe("conditions", () => {
    test("binding conditions are caller-computed facts", async () => {
        expect((await check(req("user:eve", "git:Read", rn.repo("site"), {context: {repoVisible: true}}))).decision).toBe(true)
        expect((await check(req("user:eve", "git:Read", rn.repo("site")))).decision).toBe(false)
    })
    test("unless on an allow statement", async () => {
        expect((await check(req("user:ann", "git:Push", rn.repo("site")))).decision).toBe(true)
        expect((await check(req("user:eve", "git:Push", rn.repo("site")))).decision).toBe(false)
    })
    test("mfa guardrail and the ml ceiling", async () => {
        expect((await check(req("user:cleo", "secrets:Write", rn.secret("db-pass")))).context.reasons).toEqual([expect.objectContaining({id: "secrets-need-mfa"})])
        expect((await check(req("user:cleo", "secrets:Write", rn.secret("db-pass"), {context: {mfa: true}}))).decision).toBe(true)
        expect((await check(req("user:cleo", "cloud:Launch", rn.cloud("gpu")))).decision).toBe(true)
    })
    test("a custom facts provider replaces context lookup", async () => {
        const asked: string[] = []
        const custom = new GGAuthz({model, policies, resolver: new GGAuthzMemoryResolver(data), facts: name => (asked.push(name), name === "repoVisible")})
        expect((await custom.evaluate(req("user:eve", "git:Read", rn.repo("site")))).decision).toBe(true)
        expect(asked).toEqual(["repoVisible"])
    })
})

describe("request validation", () => {
    test.each([
        ["other partition", req("user:ann", "vm:ReadWorkspace", "rn:other:vm:acme:workspace/ann-1")],
        ["not an rn", req("user:ann", "vm:ReadWorkspace", "workspace/ann-1")],
    ])("%s → request deny", async (_, request) => {
        expect((await check(request)).context.reasons).toEqual([expect.objectContaining({layer: "request", kind: "invalid"})])
    })
    test.each([
        ["unknown action", req("user:ann", "vm:Explode", "garbage"), "Unknown action"],
        ["action on the wrong type", req("user:ann", "vm:ReadWorkspace", rn.repo("site")), "does not apply"],
        ["type mismatch", {...req("user:ann", "vm:ReadWorkspace", rn.ws("ann-1")), resource: {type: "git:repo", id: rn.ws("ann-1")}}, "does not match"],
    ])("%s → throws", async (_, request, message) => {
        await expect(check(request)).rejects.toThrow(message)
    })
    test("listAllowed and batch throw on caller bugs", async () => {
        await expect(authz.listAllowed({subject: {type: "user", id: "ann"}, action: {name: "vm:Explode"}, resource: {type: "vm:workspace"}})).rejects.toThrow("Unknown action")
        await expect(authz.listAllowed({subject: {type: "user", id: "ann"}, action: {name: "vm:ReadWorkspace"}, resource: {type: "git:repo"}})).rejects.toThrow("does not apply")
        await expect(authz.evaluateBatch({evaluations: [{action: {name: "vm:ReadWorkspace"}}]})).rejects.toThrow("missing")
    })
    test("bad config fails fast", async () => {
        expect(() => new GGAuthz({model, policies: {bindings: [{principal: "user:ann", role: "nope", on: rn.org}]}, resolver: new GGAuthzMemoryResolver(data)})).toThrow("Unknown role")
        expect(() => new GGAuthz({model: {...model, roles: [{name: "x", actions: ["nope:*"]}]}, policies, resolver: new GGAuthzMemoryResolver(data)})).toThrow("Unknown action")
        expect(() => new GGAuthz({model, policies: {guardrails: [{id: "g", on: rn.org, deny: [{actions: ["vm:*"], resources: ["rn:acme:vm:acme:workspace/w*"]}]}]}, resolver: new GGAuthzMemoryResolver(data)})).toThrow()
    })
    test("AuthZEN request validator", async () => {
        expect(IsGGAuthzRequest.is(req("user:ann", "vm:ReadWorkspace", rn.ws("ann-1")))).toBe(true)
        expect(IsGGAuthzRequest.is({subject: {type: "user"}, action: {name: "x"}, resource: {type: "a", id: "b"}})).toBe(false)
    })
})

describe("batch (AuthZEN evaluations)", () => {
    test("top-level defaults fill each evaluation", async () => {
        const res = await authz.evaluateBatch({
            subject: {type: "user", id: "ann"},
            action: {name: "vm:StopWorkspace"},
            evaluations: [
                {resource: {type: "vm:workspace", id: rn.ws("ann-1")}},
                {resource: {type: "vm:workspace", id: rn.ws("cleo-1")}},
                {resource: {type: "vm:workspace", id: rn.ws("cleo-1")}, action: {name: "vm:ReadWorkspace"}},
            ],
        })
        expect(res.evaluations.map(e => e.decision)).toEqual([true, false, true])
    })
})

describe("explain", () => {
    test("allow through group role and boundary", async () => {
        const request = req("agent:ws-ben", "vm:StopWorkspace", rn.ws("ben-1"), {for: "user:ben"})
        expect(GGAuthz.explain(request, await authz.evaluate(request))).toBe(
            `agent:ws-ben (on behalf of user:ben) may vm:StopWorkspace on ${rn.ws("ben-1")} once approved (ask-once) because `
            + `user:ben has role owner on ${rn.ws("ben-1")}; group:eng has role member on ${rn.web}; boundary agents allows vm:*; approval level ask-once (set on ${rn.org}).`,
        )
    })
    test("deny by guardrail", async () => {
        const request = req("user:dan", "cloud:Launch", rn.cloud("gpu"))
        expect(GGAuthz.explain(request, await authz.evaluate(request))).toBe(`user:dan may not cloud:Launch on ${rn.cloud("gpu")}: guardrail contractors-no-paid on ${rn.org} denies cloud:Launch.`)
    })
})
