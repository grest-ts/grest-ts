import {callOn, GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {GGLocatorScope} from "@grest-ts/locator"
import {GGHeader} from "@grest-ts/http"
import {afterEach} from "vitest"
import {WireAuthRuntime} from "../src/WireAuthRuntime"
import {WireAuthMissingCreateRuntime} from "../src/WireAuthMissingCreateRuntime"
import {ORG_TOKEN_WIRE, USER_TOKEN_WIRE, WireLiveApi, WireOrgScopedApi, WirePublicApi, WireUserApi} from "../src/api/WireAuthApi"

function asUser(token: string): GGContext {
    const scope = new GGContext("wire-auth-test")
    scope.set(USER_TOKEN_WIRE, token)
    return scope
}

describe("single-token wire — HTTP end-to-end", () => {

    GGTest.startInline(WireAuthRuntime)

    let scope: GGContext | undefined
    afterEach(() => {
        scope?.reset()
        scope = undefined
    })

    test("public (wire-less) schema serves anonymous", async () => {
        expect(await callOn(WirePublicApi).ping()).toBe("pong")
    })

    test("authed schema rejects anonymous at the wire (NOT_AUTHORIZED)", async () => {
        await expect(callOn(WireUserApi).me()).rejects.toThrow(/NOT_AUTHORIZED/)
    })

    test("authed schema returns the durable principal after auth", async () => {
        scope = asUser("alice")
        expect(await callOn(WireUserApi, scope).me()).toMatchObject({username: "alice", permissions: ["WIRE_ADMIN"]})
    })

    test("per-method permission gate: holder passes", async () => {
        scope = asUser("alice")
        expect(await callOn(WireUserApi, scope).adminOnly()).toBe("admin-ok:alice")
    })

    test("per-method permission gate: non-holder gets FORBIDDEN", async () => {
        scope = asUser("bob")
        await expect(callOn(WireUserApi, scope).adminOnly()).rejects.toThrow(/FORBIDDEN/)
    })

    test("ephemeral: the raw credential is cleared before the handler runs", async () => {
        scope = asUser("alice")
        expect(await callOn(WireUserApi, scope).echoToken()).toBe("CLEARED")
    })
})

describe("single-token wire — startup enforcement", () => {

    test("a .use()d smart wire with no .create() refuses to start", async () => {
        let caught: unknown
        try {
            await GGTest.startInline(WireAuthMissingCreateRuntime)
        } catch (e) {
            caught = e
        }
        expect(caught).toBeDefined()
        const msg = (caught as Error).message ?? String(caught)
        expect(msg).toContain("WireUserApi")
        expect(msg).toMatch(/authorization/)
    })
})

describe("single-token wire — define/create lifecycle", () => {

    test(".define() twice on the same wire throws", () => {
        const wire = new GGHeader("x-ut-define", {})
        wire.define(() => ({process: async () => {}}))
        expect(() => wire.define(() => ({process: async () => {}}))).toThrow(/only be defined once/)
    })

    test(".create() twice in one runtime scope throws", () => {
        const wire = new GGHeader("x-ut-create", {})
        const reg = wire.define((_deps: object) => ({process: async () => {}}))
        new GGLocatorScope("wire-create-unit").run(() => {
            reg.create({})
            expect(() => reg.create({})).toThrow(/once per runtime/)
        })
    })
})

describe("multi-wire — AND across sources", () => {

    GGTest.startInline(WireAuthRuntime)

    let scope: GGContext | undefined
    afterEach(() => {
        scope?.reset()
        scope = undefined
    })

    function asUserAndOrg(userToken: string, orgToken: string): GGContext {
        const s = new GGContext("wire-multi-test")
        s.set(USER_TOKEN_WIRE, userToken)
        s.set(ORG_TOKEN_WIRE, orgToken)
        return s
    }

    test("passes only when BOTH wires resolve (user authn + org membership)", async () => {
        scope = asUserAndOrg("alice", "org-1")
        expect(await callOn(WireOrgScopedApi, scope).orgInfo()).toBe("org:org-1")
    })

    test("missing org token → rejected at the org wire (NOT_AUTHORIZED)", async () => {
        scope = asUser("alice")
        await expect(callOn(WireOrgScopedApi, scope).orgInfo()).rejects.toThrow(/NOT_AUTHORIZED/)
    })

    test("missing user token → rejected at the user wire (NOT_AUTHORIZED)", async () => {
        scope = new GGContext("wire-multi-test")
        scope.set(ORG_TOKEN_WIRE, "org-1")
        await expect(callOn(WireOrgScopedApi, scope).orgInfo()).rejects.toThrow(/NOT_AUTHORIZED/)
    })
})

describe("smart wire — WebSocket", () => {

    GGTest.startWorker(WireAuthRuntime)

    const urlFor = (name: string) => GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(name)

    function wsAsUser<R>(token: string, fn: () => Promise<R>): Promise<R> {
        const scope = new GGContext("wire-ws-test")
        scope.set(USER_TOKEN_WIRE, token)
        return scope.run(fn)
    }

    test("anonymous handshake is rejected at the wire", async () => {
        const client = WireLiveApi.createClient({url: urlFor("WireLiveApi")})
        await expect(client.connect()).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
    })

    test("authenticated message reads the durable principal minted at handshake", async () => {
        await wsAsUser("alice", async () => {
            const client = WireLiveApi.createClient({url: urlFor("WireLiveApi")})
            await client.connect()
            try {
                expect(await client.outgoing.whoami()).toBe("alice")
            } finally {
                await client.disconnect()
            }
        })
    })

    test("per-message gate: ADMIN holder can adminPing", async () => {
        await wsAsUser("alice", async () => {
            const client = WireLiveApi.createClient({url: urlFor("WireLiveApi")})
            await client.connect()
            try {
                expect(await client.outgoing.adminPing()).toBe("admin-pong")
            } finally {
                await client.disconnect()
            }
        })
    })

    test("per-message gate: non-holder gets FORBIDDEN", async () => {
        await wsAsUser("bob", async () => {
            const client = WireLiveApi.createClient({url: urlFor("WireLiveApi")})
            await client.connect()
            try {
                await expect(client.outgoing.adminPing()).rejects.toMatchObject({type: "FORBIDDEN"})
            } finally {
                await client.disconnect()
            }
        })
    })
})
