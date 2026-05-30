import {describe, test, expect} from "vitest"
import {IsEnum, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGContext} from "@grest-ts/context"
import {
    AuthToken, HmacSigner, InMemoryRefreshTokenStore,
    AuthGuard, scopeResolver,
} from "../index-node"
import {HeaderTokenKey} from "./wire"

enum Perm {
    Read = "read",
    Write = "write",
}

function setup() {
    const engine = new AuthToken({
        signer: new HmacSigner("ws-wiring-secret-which-is-long-enough"),
        store: new InMemoryRefreshTokenStore(),
        permission: IsEnum(Perm),
        accessTtlMs: 60_000,
        refreshTtlMs: 60_000,
    })
    const tokenKey = new HeaderTokenKey("userToken", {name: "authorization", scheme: "bearer"})
    const wire = tokenKey.wire
    const binding = new AuthGuard(engine, tokenKey)
    return {engine, tokenKey, wire, binding}
}

describe("ws wiring", () => {
    test("client updateHandshake attaches the bearer token in-band (same wire as HTTP)", async () => {
        const {engine, tokenKey, wire} = setup()
        const pair = await engine.issue("u1", [Perm.Read], {})
        new GGContext("client").run(() => {
            tokenKey.set(pair.accessToken)
            const ctx = {headers: {} as Record<string, string>, queryArgs: {}}
            wire.updateHandshake(ctx)
            expect(ctx.headers["authorization"]).toBe(`Bearer ${pair.accessToken}`)
        })
    })

    test("server: parseHandshake → wsMiddleware verifies → payload + scopes", async () => {
        const {engine, wire, binding} = setup()
        const pair = await engine.issue("u1", [Perm.Read, Perm.Write], {})
        await new GGContext("server").run(async () => {
            wire.parseHandshake({headers: {"authorization": `Bearer ${pair.accessToken}`}, queryArgs: {}})
            await binding.wsMiddleware().process()
            const payload = binding.payload()
            expect(payload?.sub).toBe("u1")
            expect(payload?.permissions).toEqual([Perm.Read, Perm.Write])
            expect(scopeResolver([binding])()?.has(Perm.Read)).toBe(true)
        })
    })

    test("missing token on a required guard → NOT_AUTHORIZED", async () => {
        const {binding} = setup()
        await new GGContext("server").run(async () => {
            await expect(binding.wsMiddleware().process()).rejects.toBeInstanceOf(NOT_AUTHORIZED)
        })
    })

    test("missing token on an optional guard → no-op, payload undefined", async () => {
        const {engine, tokenKey} = setup()
        const optional = new AuthGuard(engine, tokenKey, {required: false})
        await new GGContext("server").run(async () => {
            await optional.wsMiddleware().process()
            expect(optional.payload()).toBeUndefined()
        })
    })

    test("present-but-invalid token → NOT_AUTHORIZED", async () => {
        const {wire, binding} = setup()
        await new GGContext("server").run(async () => {
            wire.parseHandshake({headers: {"authorization": "Bearer not.a.jwt"}, queryArgs: {}})
            await expect(binding.wsMiddleware().process()).rejects.toBeInstanceOf(NOT_AUTHORIZED)
        })
    })

    test("a verbatim (non-bearer) token rides the handshake header as-is", () => {
        const orgKey = new HeaderTokenKey("orgToken", {name: "x-org-token"})
        const wire = orgKey.wire
        new GGContext("client").run(() => {
            orgKey.set("org-token-value")
            const ctx = {headers: {} as Record<string, string>, queryArgs: {}}
            wire.updateHandshake(ctx)
            expect(ctx.headers["x-org-token"]).toBe("org-token-value")
        })
    })
})
