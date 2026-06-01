import {GGHeader} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"

const inContext = (fn: () => void) => new GGContext("test").run(fn)
const inbound = (headers: Record<string, string | undefined> = {}) => ({headers, query: {}})
const outbound = () => ({headers: {} as Record<string, string>})

describe("header binding", () => {

    test("parse reads the named header (verbatim) into the wire", () => {
        inContext(() => {
            const mw = new GGHeader("x-token")
            mw.parse(inbound({"x-token": "abc123"}))
            expect(mw.get()).toBe("abc123")
        })
    })

    test("the wire name is the header name, lowercased", () => {
        inContext(() => {
            const mw = new GGHeader("X-Locale")
            mw.parse(inbound({"x-locale": "en-US"}))
            expect(mw.get()).toBe("en-US")
        })
    })

    test("scheme:bearer strips the Bearer prefix on read", () => {
        inContext(() => {
            const mw = new GGHeader("authorization", {scheme: "bearer"})
            mw.parse(inbound({authorization: "Bearer tok-42"}))
            expect(mw.get()).toBe("tok-42")
        })
    })

    test("scheme:bearer adds the Bearer prefix on write (client)", () => {
        inContext(() => {
            const mw = new GGHeader("authorization", {scheme: "bearer"})
            mw.set("tok-42")
            const out = outbound()
            mw.update(out)
            expect(out.headers["authorization"]).toBe("Bearer tok-42")
        })
    })

    test("verbatim (no scheme) round-trips the value unchanged", () => {
        inContext(() => {
            const mw = new GGHeader("x-token")
            mw.set("plain")
            const out = outbound()
            mw.update(out)
            expect(out.headers["x-token"]).toBe("plain")
            mw.delete()
            mw.parse(inbound(out.headers))
            expect(mw.get()).toBe("plain")
        })
    })

    test("update writes nothing when the wire is unset", () => {
        inContext(() => {
            const mw = new GGHeader("x-token")
            const out = outbound()
            mw.update(out)
            expect(out.headers["x-token"]).toBeUndefined()
        })
    })

    test("a missing header leaves the wire unset", () => {
        inContext(() => {
            const mw = new GGHeader("x-token")
            mw.parse(inbound({}))
            expect(mw.get()).toBeUndefined()
        })
    })

    test("WS: parse reads the handshake header; update writes it", () => {
        inContext(() => {
            const mw = new GGHeader("authorization", {scheme: "bearer"})
            mw.parse(inbound({authorization: "Bearer ws-tok"}))
            expect(mw.get()).toBe("ws-tok")

            const out = outbound()
            mw.update(out)
            expect(out.headers["authorization"]).toBe("Bearer ws-tok")
        })
    })
})
