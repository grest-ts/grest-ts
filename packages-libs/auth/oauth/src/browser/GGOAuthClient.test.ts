import {afterEach, beforeEach, describe, expect, test, vi} from "vitest"
import {GGOAuthClient} from "./GGOAuthClient"

const SERVER = "https://auth.example"
const METADATA = {
    issuer: SERVER,
    authorization_endpoint: `${SERVER}/oauth/authorize`,
    token_endpoint: `${SERVER}/oauth/token`,
    revocation_endpoint: `${SERVER}/oauth/revoke`,
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe("GGOAuthClient redirects", () => {
    let assign: ReturnType<typeof vi.fn>
    let fetchMock: ReturnType<typeof vi.fn>
    let metadata: Record<string, string>

    beforeEach(() => {
        assign = vi.fn()
        metadata = {...METADATA}
        fetchMock = vi.fn(async (url: string) => {
            if (url.endsWith("/.well-known/oauth-authorization-server")) return new Response(JSON.stringify(metadata))
            return new Response("")
        })
        vi.stubGlobal("window", {location: {assign}})
        vi.stubGlobal("sessionStorage", {setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn()})
        vi.stubGlobal("fetch", fetchMock)
    })
    afterEach(() => vi.unstubAllGlobals())

    const client = () => new GGOAuthClient({server: SERVER, clientId: "web", redirectUri: "https://app.example/cb", identity: () => ({})})

    test("a failed sign-in start doesn't block the next one", async () => {
        const oauth = client()
        fetchMock.mockImplementationOnce(async () => new Response("down", {status: 503}))
        await expect(oauth.authorize()).rejects.toThrow()
        void oauth.authorize()
        await flush()
        await flush()
        expect(assign).toHaveBeenCalledTimes(1)
        expect(new URL(assign.mock.calls[0][0]).searchParams.get("code_challenge_method")).toBe("S256")
    })

    test("a sign-in started during a logout redirect waits for it", async () => {
        const oauth = client()
        metadata.end_session_endpoint = `${SERVER}/oauth/logout`
        void oauth.logout("rt")
        void oauth.authorize()
        await flush()
        await flush()
        expect(assign).toHaveBeenCalledTimes(1)
        expect(assign.mock.calls[0][0]).toContain("/oauth/logout")
    })

    test("a sign-in waiting behind a failed logout goes ahead", async () => {
        const oauth = client()
        fetchMock.mockImplementationOnce(async () => new Response("down", {status: 503}))
        const logout = oauth.logout(undefined)
        void oauth.authorize()
        await expect(logout).rejects.toThrow()
        await flush()
        await flush()
        expect(assign).toHaveBeenCalledTimes(1)
        expect(assign.mock.calls[0][0]).toContain("/oauth/authorize")
    })

    test("without an end-session endpoint, logout resolves once the token is revoked", async () => {
        await client().logout("rt")
        expect(fetchMock).toHaveBeenCalledWith(METADATA.revocation_endpoint, expect.objectContaining({method: "POST"}))
        expect(assign).not.toHaveBeenCalled()
    })
})
