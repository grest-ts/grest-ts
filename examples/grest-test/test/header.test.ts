import {header} from "@grest-ts/http"
import {GGContext, GGContextKey} from "@grest-ts/context"
import {IsString} from "@grest-ts/schema"

const key = (name: string) => new GGContextKey<string | undefined>(name, IsString.orUndefined)
const inContext = (fn: () => void) => new GGContext("test").run(fn)
const newReq = (headers: Record<string, string | string[]> = {}) => ({headers})

describe("header binding", () => {

    test("parseRequest reads the named header (verbatim) into the key", () => {
        inContext(() => {
            const k = key("x-token")
            header(k).parseRequest!(newReq({"x-token": "abc123"}))
            expect(k.get()).toBe("abc123")
        })
    })

    test("the wire name defaults to the key name, lowercased", () => {
        inContext(() => {
            const k = key("X-Locale")
            header(k).parseRequest!(newReq({"x-locale": "en-US"}))
            expect(k.get()).toBe("en-US")
        })
    })

    test("a custom name decouples the header from the key name", () => {
        inContext(() => {
            const k = key("token")
            header(k, {name: "authorization"}).parseRequest!(newReq({authorization: "raw"}))
            expect(k.get()).toBe("raw")
        })
    })

    test("scheme:bearer strips the Bearer prefix on read", () => {
        inContext(() => {
            const k = key("token")
            const mw = header(k, {name: "authorization", scheme: "bearer"})
            mw.parseRequest!(newReq({authorization: "Bearer tok-42"}))
            expect(k.get()).toBe("tok-42")
        })
    })

    test("scheme:bearer adds the Bearer prefix on write (client)", () => {
        inContext(() => {
            const k = key("token")
            k.set("tok-42")
            const req = newReq()
            header(k, {name: "authorization", scheme: "bearer"}).updateRequest!(req)
            expect(req.headers["authorization"]).toBe("Bearer tok-42")
        })
    })

    test("verbatim (no scheme) round-trips the value unchanged", () => {
        inContext(() => {
            const k = key("x-token")
            k.set("plain")
            const req = newReq()
            const mw = header(k)
            mw.updateRequest!(req)
            expect(req.headers["x-token"]).toBe("plain")
            const k2 = key("x-token")
            mw.parseRequest!(req)
            expect(k2.get()).toBe("plain")
        })
    })

    test("updateRequest writes nothing when the key is unset", () => {
        inContext(() => {
            const k = key("x-token")
            const req = newReq()
            header(k).updateRequest!(req)
            expect(req.headers["x-token"]).toBeUndefined()
        })
    })

    test("a missing header leaves the key unset", () => {
        inContext(() => {
            const k = key("x-token")
            header(k).parseRequest!(newReq({}))
            expect(k.get()).toBeUndefined()
        })
    })

    test("an array header value reads the first element", () => {
        inContext(() => {
            const k = key("x-token")
            header(k).parseRequest!(newReq({"x-token": ["first", "second"]}))
            expect(k.get()).toBe("first")
        })
    })

    test("WS: parseHandshake reads the in-band header; updateHandshake writes it", () => {
        inContext(() => {
            const k = key("token")
            const mw = header(k, {name: "authorization", scheme: "bearer"})
            mw.parseHandshake({headers: {authorization: "Bearer ws-tok"}, queryArgs: {}})
            expect(k.get()).toBe("ws-tok")

            const ctx = {headers: {} as Record<string, string>, queryArgs: {}}
            mw.updateHandshake(ctx)
            expect(ctx.headers["authorization"]).toBe("Bearer ws-tok")
        })
    })
})
