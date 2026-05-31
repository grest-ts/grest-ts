import {GGHeader} from "@grest-ts/http"
import {GGContext, GGContextKey} from "@grest-ts/context"
import {IsString} from "@grest-ts/schema"

const key = (name: string) => new GGContextKey<string | undefined>(name, IsString.orUndefined)
const inContext = (fn: () => void) => new GGContext("test").run(fn)
const inbound = (headers: Record<string, string | undefined> = {}) => ({headers, query: {}})
const outbound = () => ({headers: {} as Record<string, string>})

describe("header binding", () => {

    test("parse reads the named header (verbatim) into the key", () => {
        inContext(() => {
            const k = key("x-token")
            new GGHeader(k.name, k).parse(inbound({"x-token": "abc123"}))
            expect(k.get()).toBe("abc123")
        })
    })

    test("the wire name defaults to the key name, lowercased", () => {
        inContext(() => {
            const k = key("X-Locale")
            new GGHeader(k.name, k).parse(inbound({"x-locale": "en-US"}))
            expect(k.get()).toBe("en-US")
        })
    })

    test("a custom name decouples the header from the key name", () => {
        inContext(() => {
            const k = key("token")
            new GGHeader("authorization", k).parse(inbound({authorization: "raw"}))
            expect(k.get()).toBe("raw")
        })
    })

    test("scheme:bearer strips the Bearer prefix on read", () => {
        inContext(() => {
            const k = key("token")
            const mw = new GGHeader("authorization", k, {scheme: "bearer"})
            mw.parse(inbound({authorization: "Bearer tok-42"}))
            expect(k.get()).toBe("tok-42")
        })
    })

    test("scheme:bearer adds the Bearer prefix on write (client)", () => {
        inContext(() => {
            const k = key("token")
            k.set("tok-42")
            const out = outbound()
            new GGHeader("authorization", k, {scheme: "bearer"}).update(out)
            expect(out.headers["authorization"]).toBe("Bearer tok-42")
        })
    })

    test("verbatim (no scheme) round-trips the value unchanged", () => {
        inContext(() => {
            const k = key("x-token")
            k.set("plain")
            const out = outbound()
            const mw = new GGHeader(k.name, k)
            mw.update(out)
            expect(out.headers["x-token"]).toBe("plain")
            const k2 = key("x-token")
            mw.parse(inbound(out.headers))
            expect(k2.get()).toBe("plain")
        })
    })

    test("update writes nothing when the key is unset", () => {
        inContext(() => {
            const k = key("x-token")
            const out = outbound()
            new GGHeader(k.name, k).update(out)
            expect(out.headers["x-token"]).toBeUndefined()
        })
    })

    test("a missing header leaves the key unset", () => {
        inContext(() => {
            const k = key("x-token")
            new GGHeader(k.name, k).parse(inbound({}))
            expect(k.get()).toBeUndefined()
        })
    })

    test("WS: parse reads the handshake header; update writes it", () => {
        inContext(() => {
            const k = key("token")
            const mw = new GGHeader("authorization", k, {scheme: "bearer"})
            mw.parse(inbound({authorization: "Bearer ws-tok"}))
            expect(k.get()).toBe("ws-tok")

            const out = outbound()
            mw.update(out)
            expect(out.headers["authorization"]).toBe("Bearer ws-tok")
        })
    })
})
