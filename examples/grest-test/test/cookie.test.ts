import {GGCookie, GG_COOKIE_WRITES} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"
import {SERVER_ERROR} from "@grest-ts/schema"

// `writes` = the cookie names this "route" declared via .updatesCookie(...). The
// scope is strict, mirroring the real server REQ context (set-once inbound).
const inRequest = (writes: string[], fn: () => void) => new GGContext("test", undefined, true).run(() => {
    GG_COOKIE_WRITES.set(new Set(writes))
    fn()
})
const inbound = (cookie?: string) => ({headers: {}, query: {}, cookie})
const newRes = () => ({headers: {} as Record<string, string | string[]>})

describe("cookie binding", () => {

    test("parse reads the cookie into the wire", () => {
        inRequest([], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound("other=x; sid=abc123; y=z"))
            expect(mw.get()).toBe("abc123")
        })
    })

    test("a declared write with per-mint options emits a hardened Set-Cookie", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound())
            GGCookie.setCookie(mw, "token123", {maxAgeSec: 3600})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=token123; Max-Age=3600; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("set with no options uses safe defaults", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            GGCookie.setCookie(mw, "t")
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("read-only handler (no setCookie) emits nothing", () => {
        inRequest([], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound("sid=incoming"))
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("no incoming cookie + no setCookie emits nothing (no spurious clear)", () => {
        inRequest([], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound())
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("clearCookie() clears the cookie (Max-Age=0)", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound("sid=abc"))
            GGCookie.clearCookie(mw)
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly"])
        })
    })

    test("clearCookie({path, domain}) clears a scoped cookie", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound("sid=abc"))
            GGCookie.clearCookie(mw, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("setCookie(undefined) with scoped options emits Max-Age=0 with matching Path/Domain", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            mw.parse!(inbound("sid=abc"))
            GGCookie.setCookie(mw, undefined, {path: "/api", domain: ".example.com"})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("SameSite=None forces Secure", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            GGCookie.setCookie(mw, "t", {sameSite: "none", secure: false})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual(["sid=t; Path=/; SameSite=None; Secure; HttpOnly"])
        })
    })

    test("multiple cookies append rather than overwrite", () => {
        inRequest(["sid", "csrf"], () => {
            const sidMw = new GGCookie("sid")
            const csrfMw = new GGCookie("csrf")
            GGCookie.setCookie(sidMw, "a")
            GGCookie.setCookie(csrfMw, "b")
            const res = newRes()
            sidMw.respond!(res)
            csrfMw.respond!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=a; Path=/; SameSite=Lax; Secure; HttpOnly",
                "csrf=b; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("malformed percent-encoding does not throw", () => {
        inRequest([], () => {
            const mw = new GGCookie("sid")
            expect(() => mw.parse!(inbound("sid=%"))).not.toThrow()
            expect(mw.get()).toBe("%")
        })
    })

    test("fractional maxAgeSec is truncated", () => {
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            GGCookie.setCookie(mw, "t", {maxAgeSec: 3.9})
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]![0]).toContain("Max-Age=3")
        })
    })

    test("illegal cookie name (binding) and bad setCookie options are rejected", () => {
        expect(() => new GGCookie("a;b")).toThrow()                                    // cookie name validated at bind
        inRequest(["sid"], () => {
            const mw = new GGCookie("sid")
            expect(() => GGCookie.setCookie(mw, "t", {path: "/x\r\ny"})).toThrow()
            expect(() => GGCookie.setCookie(mw, "t", {domain: "e;vil"})).toThrow()
            expect(() => GGCookie.setCookie(mw, "t", {maxAgeSec: NaN})).toThrow()
        })
    })

    test("setCookie on a route that did not declare .updatesCookie throws SERVER_ERROR", () => {
        inRequest([], () => {                       // route declared no writes
            const mw = new GGCookie("sid")
            mw.parse!(inbound())
            let err: unknown
            try {
                GGCookie.setCookie(mw, "sneaky")
            } catch (e) {
                err = e
            }
            expect(err).toBeInstanceOf(SERVER_ERROR)
            expect(mw.get()).toBeUndefined()        // setCookie never touches the read wire
            const res = newRes()
            mw.respond!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()   // nothing scheduled, nothing emitted
        })
    })
})
