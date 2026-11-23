import {GGHeader} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"

const inContext = (fn: () => void) => new GGContext("test").run(fn)
const inbound = (headers: Record<string, string | undefined> = {}) => ({headers, query: {}})
const outbound = () => ({headers: {} as Record<string, string>})

const X_TOKEN = new GGHeader("x-token", {key: "headerTest.xToken"})
const LOCALE = new GGHeader("X-Locale", {key: "headerTest.locale"})
const BEARER = new GGHeader("authorization", {scheme: "bearer", key: "headerTest.bearer"})

describe("header binding", () => {

    test("parse reads the named header (verbatim) into the wire", () => {
        inContext(() => {
            X_TOKEN.parse(inbound({"x-token": "abc123"}))
            expect(X_TOKEN.get()).toBe("abc123")
        })
    })

    test("the header name is matched lowercased", () => {
        inContext(() => {
            LOCALE.parse(inbound({"x-locale": "en-US"}))
            expect(LOCALE.get()).toBe("en-US")
        })
    })

    test("scheme:bearer strips the Bearer prefix on read", () => {
        inContext(() => {
            BEARER.parse(inbound({authorization: "Bearer tok-42"}))
            expect(BEARER.get()).toBe("tok-42")
        })
    })

    test("scheme:bearer adds the Bearer prefix on write (client)", () => {
        inContext(() => {
            BEARER.set("tok-42")
            const out = outbound()
            BEARER.update(out)
            expect(out.headers["authorization"]).toBe("Bearer tok-42")
        })
    })

    test("verbatim (no scheme) round-trips the value unchanged", () => {
        inContext(() => {
            X_TOKEN.set("plain")
            const out = outbound()
            X_TOKEN.update(out)
            expect(out.headers["x-token"]).toBe("plain")
            X_TOKEN.delete()
            X_TOKEN.parse(inbound(out.headers))
            expect(X_TOKEN.get()).toBe("plain")
        })
    })

    test("update writes nothing when the wire is unset", () => {
        inContext(() => {
            const out = outbound()
            X_TOKEN.update(out)
            expect(out.headers["x-token"]).toBeUndefined()
        })
    })

    test("a missing header leaves the wire unset", () => {
        inContext(() => {
            X_TOKEN.parse(inbound({}))
            expect(X_TOKEN.get()).toBeUndefined()
        })
    })

    test("WS: parse reads the handshake header; update writes it", () => {
        inContext(() => {
            BEARER.parse(inbound({authorization: "Bearer ws-tok"}))
            expect(BEARER.get()).toBe("ws-tok")

            const out = outbound()
            BEARER.update(out)
            expect(out.headers["authorization"]).toBe("Bearer ws-tok")
        })
    })
})
