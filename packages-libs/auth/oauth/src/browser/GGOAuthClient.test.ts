import {afterEach, beforeEach, describe, expect, test, vi} from "vitest"
import {GGOAuthClient} from "./GGOAuthClient"

const SERVER = "https://auth.example"
const METADATA = {
    issuer: SERVER,
    authorization_endpoint: `${SERVER}/oauth/authorize`,
    token_endpoint: `${SERVER}/oauth/token`,
    revocation_endpoint: `${SERVER}/oauth/revoke`,
}

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
        vi.stubGlobal("window", {location: {assign}, addEventListener: vi.fn()})
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
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        expect(new URL(assign.mock.calls[0][0]).searchParams.get("code_challenge_method")).toBe("S256")
    })

    test("prompt=login reaches the authorization request", async () => {
        void client().authorize({prompt: "login"})
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        expect(new URL(assign.mock.calls[0][0]).searchParams.get("prompt")).toBe("login")
    })

    test("a sign-in started during a logout redirect waits for it", async () => {
        const oauth = client()
        metadata.end_session_endpoint = `${SERVER}/oauth/logout`
        void oauth.logout("rt")
        void oauth.authorize()
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        expect(assign.mock.calls[0][0]).toContain("/oauth/logout")
    })

    test("a sign-in waiting behind a failed logout goes ahead", async () => {
        const oauth = client()
        fetchMock.mockImplementationOnce(async () => new Response("down", {status: 503}))
        const logout = oauth.logout(undefined)
        void oauth.authorize()
        await expect(logout).rejects.toThrow()
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        expect(assign.mock.calls[0][0]).toContain("/oauth/authorize")
    })

    test("coming back from the back/forward cache releases the redirect", async () => {
        const oauth = client()
        void oauth.authorize()
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        const [event, onPageShow] = (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]
        expect(event).toBe("pageshow")
        onPageShow()
        void oauth.authorize()
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(2))
    })

    test("without an end-session endpoint, logout resolves once the token is revoked", async () => {
        await client().logout("rt")
        expect(fetchMock).toHaveBeenCalledWith(METADATA.revocation_endpoint, expect.objectContaining({method: "POST"}))
        expect(assign).not.toHaveBeenCalled()
    })
})

describe("GGOAuthClient discovery from a resource", () => {
    const API = "https://api.example"
    let assign: ReturnType<typeof vi.fn>
    let documents: Record<string, object>

    beforeEach(() => {
        assign = vi.fn()
        documents = {
            [`${API}/.well-known/oauth-protected-resource`]: {resource: API, authorization_servers: [SERVER]},
            [`${SERVER}/.well-known/oauth-authorization-server`]: METADATA,
        }
        vi.stubGlobal("window", {location: {assign}, addEventListener: vi.fn()})
        vi.stubGlobal("sessionStorage", {setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn()})
        vi.stubGlobal("fetch", vi.fn(async (url: string) => documents[url] ? new Response(JSON.stringify(documents[url])) : new Response("", {status: 404})))
    })
    afterEach(() => vi.unstubAllGlobals())

    const client = () => new GGOAuthClient({resource: API, clientId: "web", redirectUri: "https://app.example/cb", identity: () => ({})})

    test("signs in at the authorization server the resource names, for that resource", async () => {
        void client().authorize()
        await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
        const url = new URL(assign.mock.calls[0][0])
        expect(url.origin + url.pathname).toBe(METADATA.authorization_endpoint)
        expect(url.searchParams.get("resource")).toBe(API)
    })

    test("metadata that doesn't match what was asked for is refused", async () => {
        documents[`${API}/.well-known/oauth-protected-resource`] = {resource: "https://other.example", authorization_servers: [SERVER]}
        await expect(client().authorize()).rejects.toThrow(/is for https:\/\/other.example/)
        documents[`${API}/.well-known/oauth-protected-resource`] = {resource: API, authorization_servers: [SERVER]}
        documents[`${SERVER}/.well-known/oauth-authorization-server`] = {...METADATA, issuer: "https://evil.example"}
        await expect(client().authorize()).rejects.toThrow(/declares issuer https:\/\/evil.example/)
        expect(assign).not.toHaveBeenCalled()
    })
})
