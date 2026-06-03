import {describe, test, expect} from "vitest"
import {IsArray, IsBoolean, IsEnum, IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {GGAuthAccessToken, HmacSigner} from "../../index-node"

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

function accessToken(overrides: { accessTtlMs?: number; audience?: string } = {}) {
    return new GGAuthAccessToken({
        signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
        claimSchema: IsClaims,
        accessTtlMs: overrides.accessTtlMs ?? 15 * 60 * 1000,
        audience: overrides.audience,
    })
}

describe("GGAuthAccessToken", () => {
    test("accessTtlMs defaults to 30 minutes", async () => {
        const now = 1_700_000_000_000
        const auth = new GGAuthAccessToken({
            signer: new HmacSigner("unit-test-secret-which-is-long-enough"),
            claimSchema: IsClaims,
            now: () => now,  // no accessTtlMs → default
        })
        const access = await auth.issue("user-1", {permissions: [Perm.Read]})
        expect(access.expiresAt).toBe(now + 30 * 60 * 1000)
    })

    test("issueAccess → verifyAccess round-trips subject + claims under data", async () => {
        const auth = accessToken()
        const access = await auth.issue("user-1", {permissions: [Perm.Read, Perm.Write]})
        const payload = await auth.verify(access.token)
        expect(payload.sub).toBe("user-1")
        expect(payload.data.permissions).toEqual([Perm.Read, Perm.Write])
        expect(payload.exp).toBeGreaterThan(payload.iat)
    })

    test("the whole claim object rides under data, opaque to the engine", async () => {
        const auth = new GGAuthAccessToken({
            signer: new HmacSigner("secret-secret-secret-secret-secret"),
            claimSchema: IsObject({orgId: IsString, admin: IsBoolean, permissions: IsArray(IsEnum(Perm))}),
            accessTtlMs: 60_000,
        })
        const access = await auth.issue("user-1", {orgId: "org-9", admin: true, permissions: [Perm.Read]})
        const payload = await auth.verify(access.token)
        expect(payload.data).toEqual({orgId: "org-9", admin: true, permissions: [Perm.Read]})
    })

    test("verified claims are frozen", async () => {
        const auth = accessToken()
        const access = await auth.issue("user-1", {permissions: [Perm.Read]})
        const payload = await auth.verify(access.token)
        expect(Object.isFrozen(payload.data)).toBe(true)
    })

    test("issueAccess mints an access token with no refresh counterpart", async () => {
        const auth = accessToken()
        const result = await auth.issue("user-1", {permissions: [Perm.Read]})
        expect(result).not.toHaveProperty("refresh")
        expect(result.expiresAt).toBeGreaterThan(Date.now())
    })

    test("tampered token is rejected as TOKEN_INVALID", async () => {
        const auth = accessToken()
        const access = await auth.issue("user-1", {permissions: [Perm.Read]})
        const tampered = access.token.slice(0, -3) + "xyz"
        await expectAuthError(auth.verify(tampered), "TOKEN_INVALID")
    })

    test("expired access token is rejected as TOKEN_EXPIRED", async () => {
        const auth = accessToken({accessTtlMs: -1000})
        const access = await auth.issue("user-1", {permissions: [Perm.Read]})
        await expectAuthError(auth.verify(access.token), "TOKEN_EXPIRED")
    })

    test("token minted for one audience is rejected by an instance with a different audience", async () => {
        const userAuth = accessToken({audience: "kratt-user"})
        const orgAuth = accessToken({audience: "kratt-org"})
        const access = await userAuth.issue("user-1", {permissions: [Perm.Read]})
        await expectAuthError(orgAuth.verify(access.token), "TOKEN_INVALID")
    })
})
