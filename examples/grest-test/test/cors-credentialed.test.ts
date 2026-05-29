import {corsResponseHeaders} from "@grest-ts/http"
import {CookieTestApi} from "../src/api/CookieTestApi"

const ALLOW = "Content-Type"

describe("corsResponseHeaders (credentialed CORS)", () => {

    test("no Origin -> no CORS headers", () => {
        expect(corsResponseHeaders(undefined, undefined, ALLOW, "")).toEqual({})
    })

    test("default (no config) -> wildcard, no credentials, no Vary", () => {
        const h = corsResponseHeaders("https://app.example.com", undefined, ALLOW, "")
        expect(h["Access-Control-Allow-Origin"]).toBe("*")
        expect(h["Access-Control-Allow-Credentials"]).toBeUndefined()
        expect(h["Vary"]).toBeUndefined()
    })

    test("credentialed + allowed -> exact origin echo + credentials + Vary", () => {
        const h = corsResponseHeaders("https://app.example.com",
            {origins: ["https://app.example.com"], credentials: true}, ALLOW, "")
        expect(h["Access-Control-Allow-Origin"]).toBe("https://app.example.com")
        expect(h["Access-Control-Allow-Credentials"]).toBe("true")
        expect(h["Vary"]).toBe("Origin")
    })

    test("credentialed + disallowed -> not reflected (only Vary)", () => {
        const h = corsResponseHeaders("https://evil.example",
            {origins: ["https://app.example.com"], credentials: true}, ALLOW, "")
        expect(h["Access-Control-Allow-Origin"]).toBeUndefined()
        expect(h["Access-Control-Allow-Credentials"]).toBeUndefined()
        expect(h["Vary"]).toBe("Origin")
    })

    test("predicate allowlist", () => {
        const h = corsResponseHeaders("https://x.example.com",
            {origins: (o) => o.endsWith(".example.com")}, ALLOW, "")
        expect(h["Access-Control-Allow-Origin"]).toBe("https://x.example.com")
    })

    test("never emits * together with credentials", () => {
        const h = corsResponseHeaders("https://app.example.com",
            {origins: ["https://app.example.com"], credentials: true}, ALLOW, "")
        expect(h["Access-Control-Allow-Origin"]).not.toBe("*")
    })
})

describe("client credentials", () => {

    test("createClient threads credentials into the transport init", async () => {
        let seen: string | undefined = "untouched"
        const transport = async (_url: string, init: {credentials?: "omit" | "same-origin" | "include"}): Promise<Response> => {
            seen = init.credentials
            return new Response('{"success":true,"type":"OK"}', {status: 200, headers: {"content-type": "application/json"}})
        }
        const client = CookieTestApi.createClient({url: "http://test.local", credentials: "include", noValidation: true, transport})
        await client.me()
        expect(seen).toBe("include")
    })

    test("credentials unset by default (fetch default)", async () => {
        let seen: string | undefined = "untouched"
        const transport = async (_url: string, init: {credentials?: "omit" | "same-origin" | "include"}): Promise<Response> => {
            seen = init.credentials
            return new Response('{"success":true,"type":"OK"}', {status: 200, headers: {"content-type": "application/json"}})
        }
        const client = CookieTestApi.createClient({url: "http://test.local", noValidation: true, transport})
        await client.me()
        expect(seen).toBeUndefined()
    })
})
