import {GGCookie, GG_COOKIE_WRITES} from "@grest-ts/http"
import {GGContext, GGContextKey} from "@grest-ts/context"
import {IsString, SERVER_ERROR} from "@grest-ts/schema"

const key = (name: string) => new GGContextKey<string | undefined>(name, IsString.orUndefined)
// `writes` = the context-key names this "route" declared via .updatesCookie(...). The
// scope is strict, mirroring the real server REQ context (set-once inbound).
const inRequest = (writes: string[], fn: () => void) => new GGContext("test", undefined, true).run(() => {
    GG_COOKIE_WRITES.set(new Set(writes))
    fn()
})
const inbound = (cookie?: string) => ({headers: {}, query: {}, cookie})
const newRes = () => ({headers: {} as Record<string, string | string[]>})

describe("cookie binding", () => {

    test("parse reads the cookie (named by the key) into the key", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound("other=x; sid=abc123; y=z"))
            expect(k.get()).toBe("abc123")
        })
    })

    test("a declared write with per-mint options emits a hardened Set-Cookie", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound())
            GGCookie.setCookie(k, "token123", {maxAgeSec: 3600})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=token123; Max-Age=3600; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("set with no options uses safe defaults", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            GGCookie.setCookie(k, "t")
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("read-only handler (no setCookie) emits nothing", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound("sid=incoming"))
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("no incoming cookie + no setCookie emits nothing (no spurious clear)", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound())
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("clearCookie() clears the cookie (Max-Age=0)", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound("sid=abc"))
            GGCookie.clearCookie(k)
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("clearCookie({path, domain}) clears a scoped cookie", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound("sid=abc"))
            GGCookie.clearCookie(k, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("setCookie(undefined) with scoped options emits Max-Age=0 with matching Path/Domain", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound("sid=abc"))
            GGCookie.setCookie(k, undefined, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("SameSite=None forces Secure", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            GGCookie.setCookie(k, "t", {sameSite: "none", secure: false})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=None; Secure; HttpOnly"])
        })
    })

    test("multiple cookies append rather than overwrite", () => {
        inRequest(["sid", "csrf"], () => {
            const sid = key("sid")
            const csrf = key("csrf")
            const sidMw = new GGCookie(sid.name, sid)
            const csrfMw = new GGCookie(csrf.name, csrf)
            GGCookie.setCookie(sid, "a")
            GGCookie.setCookie(csrf, "b")
            const res = newRes()
            sidMw.respond!(res)
            csrfMw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=a; Path=/; SameSite=Lax; Secure; HttpOnly",
                "csrf=b; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("a custom wire name decouples the cookie name from the key name", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie("session_id", k)
            mw.parse!(inbound("session_id=abc"))
            expect(k.get()).toBe("abc")
            GGCookie.setCookie(k, "new")
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["session_id=new; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("malformed percent-encoding does not throw", () => {
        inRequest([], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            expect(() => mw.parse!(inbound("sid=%"))).not.toThrow()
            expect(k.get()).toBe("%")
        })
    })

    test("fractional maxAgeSec is truncated", () => {
        inRequest(["sid"], () => {
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            GGCookie.setCookie(k, "t", {maxAgeSec: 3.9})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]![0]).toContain("Max-Age=3")
        })
    })

    test("illegal cookie name (binding) and bad setCookie options are rejected", () => {
        expect(() => new GGCookie(key("a;b").name, key("a;b"))).toThrow()                                    // wire name validated at bind
        expect(() => inRequest(["sid"], () => GGCookie.setCookie(key("sid"), "t", {path: "/x\r\ny"}))).toThrow()
        expect(() => inRequest(["sid"], () => GGCookie.setCookie(key("sid"), "t", {domain: "e;vil"}))).toThrow()
        expect(() => inRequest(["sid"], () => GGCookie.setCookie(key("sid"), "t", {maxAgeSec: NaN}))).toThrow()
    })

    test("setCookie on a route that did not declare .updatesCookie throws SERVER_ERROR", () => {
        inRequest([], () => {                       // route declared no writes
            const k = key("sid")
            const mw = new GGCookie(k.name, k)
            mw.parse!(inbound())
            let err: unknown
            try {
                GGCookie.setCookie(k, "sneaky")
            } catch (e) {
                err = e
            }
            expect(err).toBeInstanceOf(SERVER_ERROR)
            expect(k.get()).toBeUndefined()         // setCookie never touches the read key
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()   // nothing scheduled, nothing emitted
        })
    })
})
