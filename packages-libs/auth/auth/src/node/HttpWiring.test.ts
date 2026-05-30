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
        signer: new HmacSigner("http-wiring-secret-which-is-long-enough"),
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

describe("http wiring", () => {
    test("client updateRequest attaches the bearer header", async () => {
        const {engine, tokenKey, wire} = setup()
        const pair = await engine.issue("u1", [Perm.Read], {})
        new GGContext("client").run(() => {
            tokenKey.set(pair.accessToken)
            const req: {headers?: Record<string, string | string[]>} = {}
            wire.updateRequest!(req)
            expect(req.headers?.["authorization"]).toBe(`Bearer ${pair.accessToken}`)
        })
    })

    test("server: parseRequest → middleware verifies → payload + scopes", async () => {
        const {engine, wire, binding} = setup()
        const pair = await engine.issue("u1", [Perm.Read, Perm.Write], {})
        await new GGContext("server").run(async () => {
            wire.parseRequest!({headers: {"authorization": `Bearer ${pair.accessToken}`}})
            await binding.httpMiddleware().process()
            const payload = binding.payload()
            expect(payload?.sub).toBe("u1")
            expect(payload?.permissions).toEqual([Perm.Read, Perm.Write])
            expect(scopeResolver([binding])()?.has(Perm.Read)).toBe(true)
        })
    })

    test("absent token on a required binding → NOT_AUTHORIZED (fail-closed default)", async () => {
        const {binding} = setup()
        await new GGContext("server").run(async () => {
            await expect(binding.httpMiddleware().process()).rejects.toBeInstanceOf(NOT_AUTHORIZED)
        })
    })

    test("absent token on an optional binding → no-op, payload undefined, resolver null", async () => {
        const {engine, tokenKey} = setup()
        const optional = new AuthGuard(engine, tokenKey, {required: false})
        await new GGContext("server").run(async () => {
            await optional.httpMiddleware().process()
            expect(optional.payload()).toBeUndefined()
            expect(scopeResolver([optional])()).toBeNull()
        })
    })

    test("present-but-invalid token → NOT_AUTHORIZED (AuthError mapped)", async () => {
        const {wire, binding} = setup()
        await new GGContext("server").run(async () => {
            wire.parseRequest!({headers: {"authorization": "Bearer not.a.jwt"}})
            await expect(binding.httpMiddleware().process()).rejects.toBeInstanceOf(NOT_AUTHORIZED)
        })
    })

    test("verbatim scheme (no bearer) reads/writes the header as-is", async () => {
        const engine = new AuthToken({
            signer: new HmacSigner("raw-scheme-secret-which-is-long-enough"),
            store: new InMemoryRefreshTokenStore(),
            permission: IsEnum(Perm),
            accessTtlMs: 60_000,
            refreshTtlMs: 60_000,
        })
        const orgKey = new HeaderTokenKey("orgToken", {name: "x-org-token"})
        const wire = orgKey.wire
        const binding = new AuthGuard(engine, orgKey)
        const pair = await engine.issue("u1", [Perm.Write], {})
        await new GGContext("server").run(async () => {
            wire.parseRequest!({headers: {"x-org-token": pair.accessToken}})
            await binding.httpMiddleware().process()
            expect(binding.payload()?.permissions).toEqual([Perm.Write])
        })
    })
})
