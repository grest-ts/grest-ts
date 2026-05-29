import {createCookieMiddleware, GGContextKeyForCookie, GG_COOKIE_WRITES} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"
import {SERVER_ERROR} from "@grest-ts/schema"

const cookie = (name: string) => new GGContextKeyForCookie(name)
// `writes` = the context-key names this "route" declared via .updatesCookie(...).
const inRequest = (writes: string[], fn: () => void) => new GGContext("test").run(() => {
    GG_COOKIE_WRITES.set(new Set(writes))
    fn()
})
const newRes = () => ({headers: {} as Record<string, string | string[]>})

describe("cookie middleware", () => {

    test("parseRequest reads the cookie (named by the key) into the key", () => {
        inRequest([], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {cookie: "other=x; sid=abc123; y=z"}})
            expect(k.get()).toBe("abc123")
        })
    })

    test("a declared write with per-mint options emits a hardened Set-Cookie", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {}})
            k.set("token123", {maxAgeSec: 3600})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=token123; Max-Age=3600; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("set with no options uses safe defaults", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            k.set("t")
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("unchanged value (read-only handler) emits nothing", () => {
        inRequest([], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {cookie: "sid=incoming"}})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("no incoming cookie + untouched emits nothing (no spurious clear)", () => {
        inRequest([], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {}})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("delete() clears the cookie (Max-Age=0)", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            k.delete()
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("delete({path, domain}) clears a scoped cookie", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            k.delete({path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("clearing with scoped options emits Max-Age=0 with matching Path/Domain", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            k.set(undefined, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("SameSite=None forces Secure", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            k.set("t", {sameSite: "none", secure: false})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=None; Secure; HttpOnly"])
        })
    })

    test("multiple cookies append rather than overwrite", () => {
        inRequest(["sid", "csrf"], () => {
            const sid = cookie("sid")
            const csrf = cookie("csrf")
            const sidMw = createCookieMiddleware(sid)
            const csrfMw = createCookieMiddleware(csrf)
            sid.set("a")
            csrf.set("b")
            const res = newRes()
            sidMw.updateResponse!(res)
            csrfMw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=a; Path=/; SameSite=Lax; Secure; HttpOnly",
                "csrf=b; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("malformed percent-encoding does not throw", () => {
        inRequest([], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            expect(() => mw.parseRequest!({headers: {cookie: "sid=%"}})).not.toThrow()
            expect(k.get()).toBe("%")
        })
    })

    test("fractional maxAgeSec is truncated", () => {
        inRequest(["sid"], () => {
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            k.set("t", {maxAgeSec: 3.9})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]![0]).toContain("Max-Age=3")
        })
    })

    test("illegal cookie name (construction) and bad set options are rejected", () => {
        expect(() => cookie("a;b")).toThrow()                                   // wire name validated at construction
        expect(() => new GGContext("t").run(() => cookie("sid").set("t", {path: "/x\r\ny"}))).toThrow()
        expect(() => new GGContext("t").run(() => cookie("sid").set("t", {domain: "e;vil"}))).toThrow()
        expect(() => new GGContext("t").run(() => cookie("sid").set("t", {maxAgeSec: NaN}))).toThrow()
    })

    test("changing a cookie the route did not declare throws SERVER_ERROR and rolls back", () => {
        inRequest([], () => {                       // route declared no writes
            const k = cookie("sid")
            const mw = createCookieMiddleware(k)
            mw.parseRequest!({headers: {}})
            k.set("sneaky")
            const res = newRes()
            let err: unknown
            try {
                mw.updateResponse!(res)
            } catch (e) {
                err = e
            }
            expect(err).toBeInstanceOf(SERVER_ERROR)
            expect(res.headers["set-cookie"]).toBeUndefined()   // nothing emitted
            expect(k.get()).toBeUndefined()                     // change was rolled back
        })
    })
})
