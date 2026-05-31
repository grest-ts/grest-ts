import {callOn, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {GGLocatorScope} from "@grest-ts/locator"
import {GGHeader} from "@grest-ts/http"
import {afterEach} from "vitest"
import {WireAuthRuntime} from "../src/WireAuthRuntime"
import {WireAuthMissingCreateRuntime} from "../src/WireAuthMissingCreateRuntime"
import {IsWirePermission, USER_TOKEN_WIRE, WirePublicApi, WireUserApi} from "../src/api/WireAuthApi"

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
        const wire = new GGHeader("x-ut-define", {permissions: IsWirePermission})
        wire.define(() => ({process: async () => {}}))
        expect(() => wire.define(() => ({process: async () => {}}))).toThrow(/only be defined once/)
    })

    test(".create() twice in one runtime scope throws", () => {
        const wire = new GGHeader("x-ut-create", {permissions: IsWirePermission})
        const reg = wire.define((_deps: object) => ({process: async () => {}}))
        new GGLocatorScope("wire-create-unit").run(() => {
            reg.create({})
            expect(() => reg.create({})).toThrow(/once per runtime/)
        })
    })
})
