import {describe, test, expect} from "vitest"
import {IsArray, IsBoolean, IsEnum, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {GGAuthToken, HmacSigner, InMemoryRefreshTokenStore, IsRefreshTokenRecord} from "../../index-node"

enum Perm {
    Read = "read",
    Write = "write",
    Admin = "admin",
}

const IsClaims = IsObject({permissions: IsArray(IsEnum(Perm))})

async function expectAuthError(p: Promise<unknown>, code: string): Promise<void> {
    let err: any
    try {
        await p
    } catch (e) {
        err = e
    }
    expect(err).toBeInstanceOf(NOT_AUTHORIZED)
    expect(err.getDebugContext()?.debugMessage).toContain(code)
}

function permToken(overrides: {accessTtlMs?: number; refreshTtlMs?: number} = {}) {
    return new GGAuthToken({
        signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
        store: new InMemoryRefreshTokenStore(),
        claimSchema: IsClaims,
        accessTtlMs: overrides.accessTtlMs ?? 15 * 60 * 1000,
        refreshTtlMs: overrides.refreshTtlMs ?? 30 * 24 * 60 * 60 * 1000,
    })
}

describe("GGAuthToken — access", () => {
    test("issue → verifyAccess round-trips subject + claims under data", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read, Perm.Write]})
        const payload = await auth.verifyAccess(pair.access.token)
        expect(payload.sub).toBe("user-1")
        expect(payload.data.permissions).toEqual([Perm.Read, Perm.Write])
        expect(payload.exp).toBeGreaterThan(payload.iat)
    })

    test("the whole claim object rides under data, opaque to the engine", async () => {
        const auth = new GGAuthToken({
            signer: new HmacSigner("secret-secret-secret-secret-secret"),
            store: new InMemoryRefreshTokenStore(),
            claimSchema: IsObject({orgId: IsString, admin: IsBoolean, permissions: IsArray(IsEnum(Perm))}),
            accessTtlMs: 60_000,
            refreshTtlMs: 60_000,
        })
        const pair = await auth.issue("user-1", {orgId: "org-9", admin: true, permissions: [Perm.Read]})
        const payload = await auth.verifyAccess(pair.access.token)
        expect(payload.data).toEqual({orgId: "org-9", admin: true, permissions: [Perm.Read]})
    })

    test("verified claims are frozen", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const payload = await auth.verifyAccess(pair.access.token)
        expect(Object.isFrozen(payload.data)).toBe(true)
    })

    test("tampered token is rejected as TOKEN_INVALID", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const tampered = pair.access.token.slice(0, -3) + "xyz"
        await expectAuthError(auth.verifyAccess(tampered), "TOKEN_INVALID")
    })

    test("expired access token is rejected as TOKEN_EXPIRED", async () => {
        const auth = permToken({accessTtlMs: -1000})
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await expectAuthError(auth.verifyAccess(pair.access.token), "TOKEN_EXPIRED")
    })
})

describe("GGAuthToken — refresh", () => {
    test("refresh re-resolves claims for a fresh access token", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const next = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read, Perm.Admin]}))
        const payload = await auth.verifyAccess(next.access.token)
        expect(payload.data.permissions).toEqual([Perm.Read, Perm.Admin])
        expect(next.refresh.token).not.toBe(pair.refresh.token)
    })

    test("replaying a rotated token is reuse: REFRESH_REUSE, and the whole family is burned", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const child = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))
        // Re-presenting the spent parent trips reuse detection.
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_REUSE")
        // ...which severs the whole lineage — the live child is revoked too.
        await expectAuthError(auth.refresh(child.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("reuse detection is scoped to the offending family — other logins survive", async () => {
        const auth = permToken()
        const sessionA = await auth.issue("user-1", {permissions: [Perm.Read]})
        const sessionB = await auth.issue("user-1", {permissions: [Perm.Read]})
        await auth.refresh(sessionA.refresh.token, async () => ({permissions: [Perm.Read]}))
        await expectAuthError(auth.refresh(sessionA.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_REUSE")
        const bNext = await auth.refresh(sessionB.refresh.token, async () => ({permissions: [Perm.Read]}))
        expect(await auth.verifyAccess(bNext.access.token)).toMatchObject({sub: "user-1"})
    })

    test("unknown refresh token is rejected", async () => {
        const auth = permToken()
        await expectAuthError(auth.refresh("not-a-real-token", async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("expired refresh token is rejected", async () => {
        const auth = permToken({refreshTtlMs: -1000})
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("revoke invalidates the refresh token", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await auth.revoke(pair.refresh.token)
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("revokeAll drops every refresh token for a subject", async () => {
        const auth = permToken()
        const first = await auth.issue("user-1", {permissions: [Perm.Read]})
        const second = await auth.issue("user-1", {permissions: [Perm.Read]})
        await auth.revokeAll("user-1")
        for (const pair of [first, second]) {
            await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
        }
    })

    test("resolve failure restores the refresh token so a retry succeeds", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const boom = new Error("transient DB error")
        await expect(auth.refresh(pair.refresh.token, async () => { throw boom })).rejects.toBe(boom)
        const next = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Write]}))
        const payload = await auth.verifyAccess(next.access.token)
        expect(payload.data.permissions).toEqual([Perm.Write])
    })

    test("resolve returning undefined (subject gone) is rejected and restores the token", async () => {
        const auth = permToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await expect(auth.refresh(pair.refresh.token, async () => undefined)).rejects.toBeInstanceOf(NOT_FOUND)
        const next = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))
        expect(await auth.verifyAccess(next.access.token)).toMatchObject({sub: "user-1"})
    })
})

describe("GGAuthToken — audience", () => {
    function audienceToken(audience: string) {
        return new GGAuthToken({
            signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
            store: new InMemoryRefreshTokenStore(),
            claimSchema: IsClaims,
            accessTtlMs: 15 * 60 * 1000,
            refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
            audience,
        })
    }

    test("token minted for one audience is rejected by an instance with a different audience", async () => {
        const userAuth = audienceToken("kratt-user")
        const orgAuth = audienceToken("kratt-org")
        const pair = await userAuth.issue("user-1", {permissions: [Perm.Read]})
        await expectAuthError(orgAuth.verifyAccess(pair.access.token), "TOKEN_INVALID")
    })
})

describe("GGAuthToken — access-only (no store)", () => {
    function accessOnlyToken() {
        return new GGAuthToken({
            signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
            claimSchema: IsClaims,
            accessTtlMs: 15 * 60 * 1000,
            refreshTtlMs: 15 * 60 * 1000,
        })
    }

    test("issueAccess mints a verifiable access token with no refresh counterpart", async () => {
        const auth = accessOnlyToken()
        const access = await auth.issueAccess("user-1", {permissions: [Perm.Read, Perm.Write]})
        expect(access).not.toHaveProperty("refresh")
        expect(access.access.expiresAt).toBeGreaterThan(Date.now())
        const payload = await auth.verifyAccess(access.access.token)
        expect(payload.sub).toBe("user-1")
        expect(payload.data.permissions).toEqual([Perm.Read, Perm.Write])
    })

    test("issue/refresh/revoke throw without a store", async () => {
        const auth = accessOnlyToken()
        await expect(auth.issue("user-1", {permissions: [Perm.Read]})).rejects.toThrow(/RefreshTokenStore/)
        await expect(auth.refresh("x", async () => ({permissions: []}))).rejects.toThrow(/RefreshTokenStore/)
        await expect(auth.revoke("x")).rejects.toThrow(/RefreshTokenStore/)
        await expect(auth.revokeAll("user-1")).rejects.toThrow(/RefreshTokenStore/)
    })

    test("issueAccess also works when a store IS configured (store untouched)", async () => {
        const auth = permToken()
        const access = await auth.issueAccess("user-1", {permissions: [Perm.Write]})
        const payload = await auth.verifyAccess(access.access.token)
        expect(payload.data.permissions).toEqual([Perm.Write])
    })
})

describe("InMemoryRefreshTokenStore — sweep & markSpent", () => {
    test("expired records are dropped on the next save", async () => {
        let now = 1000
        const store = new InMemoryRefreshTokenStore(() => now)
        await store.save(IsRefreshTokenRecord.parse({tokenHash: "a", subject: "u", familyId: "f", createdAt: 0, expiresAt: 2000}))
        now = 3000
        await store.save(IsRefreshTokenRecord.parse({tokenHash: "b", subject: "u", familyId: "f", createdAt: 0, expiresAt: 9999}))
        expect(await store.find("a")).toBeUndefined()
        expect(await store.find("b")).toMatchObject({tokenHash: "b"})
    })

    test("markSpent is single-winner: live→true, already-spent→false, absent→false", async () => {
        const store = new InMemoryRefreshTokenStore()
        await store.save(IsRefreshTokenRecord.parse({tokenHash: "t", subject: "u", familyId: "f", createdAt: 0, expiresAt: 9_999_999_999_999}))
        expect(await store.markSpent("t", 1)).toBe(true)
        expect(await store.markSpent("t", 2)).toBe(false)
        expect(await store.markSpent("missing", 1)).toBe(false)
    })
})
