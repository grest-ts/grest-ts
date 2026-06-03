import {describe, test, expect} from "vitest"
import {IsArray, IsEnum, IsObject, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {GGAuthAccessToken, GGAuthRefreshToken, HmacSigner, InMemoryRefreshTokenStore, IsRefreshTokenRecord} from "../../index-node"

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

function refreshToken(overrides: {accessTtlMs?: number; refreshTtlMs?: number} = {}) {
    return new GGAuthRefreshToken({
        store: new InMemoryRefreshTokenStore(),
        refreshTtlMs: overrides.refreshTtlMs ?? 30 * 24 * 60 * 60 * 1000,
        access: new GGAuthAccessToken({
            signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
            claimSchema: IsClaims,
            accessTtlMs: overrides.accessTtlMs ?? 15 * 60 * 1000,
        }),
    })
}

// Variant with a controllable clock + reuse grace, for the lost-response tests.
function graceRefreshToken(reuseGraceMs: number, clock: {now: number}) {
    const now = () => clock.now
    return new GGAuthRefreshToken({
        store: new InMemoryRefreshTokenStore(now),
        refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
        reuseGraceMs,
        now,
        access: new GGAuthAccessToken({
            signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
            claimSchema: IsClaims,
            accessTtlMs: 15 * 60 * 1000,
        }),
    })
}

describe("GGAuthRefreshToken — issue & refresh", () => {
    test("issue → access.verify round-trips subject + claims under data", async () => {
        const auth = refreshToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read, Perm.Write]})
        const payload = await auth.access.verify(pair.access.token)
        expect(payload.sub).toBe("user-1")
        expect(payload.data.permissions).toEqual([Perm.Read, Perm.Write])
    })

    test("refresh re-resolves claims for a fresh access token", async () => {
        const auth = refreshToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const next = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read, Perm.Admin]}))
        const payload = await auth.access.verify(next.access.token)
        expect(payload.data.permissions).toEqual([Perm.Read, Perm.Admin])
        expect(next.refresh.token).not.toBe(pair.refresh.token)
    })

    test("replaying a rotated token is reuse: REFRESH_REUSE, and the whole family is burned", async () => {
        const auth = refreshToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const child = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))
        // Re-presenting the spent parent trips reuse detection.
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_REUSE")
        // ...which severs the whole lineage — the live child is revoked too.
        await expectAuthError(auth.refresh(child.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("reuse grace: re-presenting a token spent within the window re-rotates instead of revoking", async () => {
        const clock = {now: 1_000_000}
        const auth = graceRefreshToken(30_000, clock)
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const child = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))  // spends pair

        clock.now += 10_000  // within grace
        // Lost-response retry of the spent parent: forgiven, issues a fresh pair.
        const retry = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))
        expect(retry.refresh.token).toBeTruthy()
        // Family survived — the earlier child is still live (would throw
        // REFRESH_INVALID if the lineage had been revoked).
        const childNext = await auth.refresh(child.refresh.token, async () => ({permissions: [Perm.Read]}))
        expect(childNext.refresh.token).toBeTruthy()
    })

    test("reuse grace: re-presenting after the window is reuse → family burned", async () => {
        const clock = {now: 1_000_000}
        const auth = graceRefreshToken(30_000, clock)
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const child = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))

        clock.now += 31_000  // past the grace window
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_REUSE")
        await expectAuthError(auth.refresh(child.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("reuse detection is scoped to the offending family — other logins survive", async () => {
        const auth = refreshToken()
        const sessionA = await auth.issue("user-1", {permissions: [Perm.Read]})
        const sessionB = await auth.issue("user-1", {permissions: [Perm.Read]})
        await auth.refresh(sessionA.refresh.token, async () => ({permissions: [Perm.Read]}))
        await expectAuthError(auth.refresh(sessionA.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_REUSE")
        const bNext = await auth.refresh(sessionB.refresh.token, async () => ({permissions: [Perm.Read]}))
        expect(await auth.access.verify(bNext.access.token)).toMatchObject({sub: "user-1"})
    })

    test("unknown refresh token is rejected", async () => {
        const auth = refreshToken()
        await expectAuthError(auth.refresh("not-a-real-token", async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("expired refresh token is rejected", async () => {
        const auth = refreshToken({refreshTtlMs: -1000})
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("revoke invalidates the refresh token", async () => {
        const auth = refreshToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await auth.revoke(pair.refresh.token)
        await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
    })

    test("revokeAll drops every refresh token for a subject", async () => {
        const auth = refreshToken()
        const first = await auth.issue("user-1", {permissions: [Perm.Read]})
        const second = await auth.issue("user-1", {permissions: [Perm.Read]})
        await auth.revokeAll("user-1")
        for (const pair of [first, second]) {
            await expectAuthError(auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]})), "REFRESH_INVALID")
        }
    })

    test("resolve failure restores the refresh token so a retry succeeds", async () => {
        const auth = refreshToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        const boom = new Error("transient DB error")
        await expect(auth.refresh(pair.refresh.token, async () => { throw boom })).rejects.toBe(boom)
        const next = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Write]}))
        const payload = await auth.access.verify(next.access.token)
        expect(payload.data.permissions).toEqual([Perm.Write])
    })

    test("resolve returning undefined (subject gone) is rejected and restores the token", async () => {
        const auth = refreshToken()
        const pair = await auth.issue("user-1", {permissions: [Perm.Read]})
        await expect(auth.refresh(pair.refresh.token, async () => undefined)).rejects.toBeInstanceOf(NOT_FOUND)
        const next = await auth.refresh(pair.refresh.token, async () => ({permissions: [Perm.Read]}))
        expect(await auth.access.verify(next.access.token)).toMatchObject({sub: "user-1"})
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
