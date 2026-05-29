import {cookie, setCookie, clearCookie, GG_COOKIE_WRITES, readCookie} from "@grest-ts/http"
import {GGContext, GGContextKey} from "@grest-ts/context"
import {IsString, SERVER_ERROR} from "@grest-ts/schema"

const key = (name: string) => new GGContextKey<string | undefined>(name, IsString.orUndefined)
// `writes` = the context-key names this "route" declared via .updatesCookie(...). The
// scope is strict, mirroring the real server REQ context (set-once inbound).
const inRequest = (writes: string[], fn: () => void) => new GGContext("test", undefined, true).run(() => {
    GG_COOKIE_WRITES.set(new Set(writes))
    fn()
})
const newRes = () => ({headers: {} as Record<string, string | string[]>})

describe("cookie binding", () => {

    test("parseRequest reads the cookie (named by the key) into the key", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {cookie: "other=x; sid=abc123; y=z"}})
            expect(k.get()).toBe("abc123")
        })
    })

    test("a declared write with per-mint options emits a hardened Set-Cookie", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {}})
            setCookie(k, "token123", {maxAgeSec: 3600})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=token123; Max-Age=3600; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("set with no options uses safe defaults", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            setCookie(k, "t")
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("read-only handler (no setCookie) emits nothing", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {cookie: "sid=incoming"}})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("no incoming cookie + no setCookie emits nothing (no spurious clear)", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {}})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("clearCookie() clears the cookie (Max-Age=0)", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            clearCookie(k)
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("clearCookie({path, domain}) clears a scoped cookie", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            clearCookie(k, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("setCookie(undefined) with scoped options emits Max-Age=0 with matching Path/Domain", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            setCookie(k, undefined, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("SameSite=None forces Secure", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            setCookie(k, "t", {sameSite: "none", secure: false})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=None; Secure; HttpOnly"])
        })
    })

    test("multiple cookies append rather than overwrite", () => {
        inRequest(["sid", "csrf"], () => {
            const sid = key("sid")
            const csrf = key("csrf")
            const sidMw = cookie(sid)
            const csrfMw = cookie(csrf)
            setCookie(sid, "a")
            setCookie(csrf, "b")
            const res = newRes()
            sidMw.updateResponse!(res)
            csrfMw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=a; Path=/; SameSite=Lax; Secure; HttpOnly",
                "csrf=b; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("a custom wire name decouples the cookie name from the key name", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k, {name: "session_id"})
            mw.parseRequest!({headers: {cookie: "session_id=abc"}})
            expect(k.get()).toBe("abc")
            setCookie(k, "new")
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual(["session_id=new; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("malformed percent-encoding does not throw", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = cookie(k)
            expect(() => mw.parseRequest!({headers: {cookie: "sid=%"}})).not.toThrow()
            expect(k.get()).toBe("%")
        })
    })

    test("fractional maxAgeSec is truncated", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = cookie(k)
            setCookie(k, "t", {maxAgeSec: 3.9})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]![0]).toContain("Max-Age=3")
        })
    })

    test("illegal cookie name (binding) and bad setCookie options are rejected", () => {
        expect(() => cookie(key("a;b"))).toThrow()                                                          // wire name validated at bind
        expect(() => inRequest(["sid"], () => setCookie(key("sid"), "t", {path: "/x\r\ny"}))).toThrow()
        expect(() => inRequest(["sid"], () => setCookie(key("sid"), "t", {domain: "e;vil"}))).toThrow()
        expect(() => inRequest(["sid"], () => setCookie(key("sid"), "t", {maxAgeSec: NaN}))).toThrow()
    })

    test("setCookie on a route that did not declare .updatesCookie throws SERVER_ERROR", () => {
        inRequest([], () => {                       // route declared no writes
            const k = key("sid")
            const mw = cookie(k)
            mw.parseRequest!({headers: {}})
            let err: unknown
            try {
                setCookie(k, "sneaky")
            } catch (e) {
                err = e
            }
            expect(err).toBeInstanceOf(SERVER_ERROR)
            expect(k.get()).toBeUndefined()         // setCookie never touches the read key
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()   // nothing scheduled, nothing emitted
        })
    })
})

describe("readCookie (shared HTTP/WS parse)", () => {

    test("extracts the named cookie, ignoring others and surrounding spaces", () => {
        expect(readCookie("other=x; sid=abc123; y=z", "sid")).toBe("abc123")
        expect(readCookie("  sid=abc123  ", "sid")).toBe("abc123")
    })

    test("decodes percent-encoding, falling back to raw on malformed input", () => {
        expect(readCookie("sid=a%20b", "sid")).toBe("a b")
        expect(readCookie("sid=%", "sid")).toBe("%")
    })

    test("returns undefined for missing name or missing header", () => {
        expect(readCookie("other=x", "sid")).toBeUndefined()
        expect(readCookie(undefined, "sid")).toBeUndefined()
        expect(readCookie("", "sid")).toBeUndefined()
    })

    test("a bare name (sid=) is a present empty string, not absent", () => {
        expect(readCookie("sid=", "sid")).toBe("")
        expect(readCookie("a=1; sid=; b=2", "sid")).toBe("")
    })
})
