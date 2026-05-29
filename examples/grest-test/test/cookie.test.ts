import {createCookieMiddleware} from "@grest-ts/http"
import {GGContext, GGContextKey} from "@grest-ts/context"
import {IsString} from "@grest-ts/schema"

const key = (name: string) => new GGContextKey<string | undefined>(name, IsString.orUndefined)
const inRequest = (fn: () => void) => new GGContext("test").run(fn)
const newRes = () => ({headers: {} as Record<string, string | string[]>})

describe("cookie middleware", () => {

    test("parseRequest reads the named cookie into the key", () => {
        inRequest(() => {
            const k = key("s_parse")
            const mw = createCookieMiddleware(k, {cookieName: "sid"})
            mw.parseRequest!({headers: {cookie: "other=x; sid=abc123; y=z"}})
            expect(k.get()).toBe("abc123")
        })
    })

    test("setting a value emits a hardened Set-Cookie", () => {
        inRequest(() => {
            const k = key("s_set")
            const mw = createCookieMiddleware(k, {cookieName: "sid", maxAgeSec: 3600})
            mw.parseRequest!({headers: {}})
            k.set("token123")
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=token123; Max-Age=3600; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("unchanged value (read-only handler) emits nothing", () => {
        inRequest(() => {
            const k = key("s_noop")
            const mw = createCookieMiddleware(k, {cookieName: "sid"})
            mw.parseRequest!({headers: {cookie: "sid=incoming"}})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("no incoming cookie + untouched emits nothing (no spurious clear)", () => {
        inRequest(() => {
            const k = key("s_absent")
            const mw = createCookieMiddleware(k, {cookieName: "sid"})
            mw.parseRequest!({headers: {}})
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("clearing (set undefined) when a value arrived emits Max-Age=0 with the same scope", () => {
        inRequest(() => {
            const k = key("s_clear")
            const mw = createCookieMiddleware(k, {cookieName: "sid", path: "/api", domain: ".example.com"})
            mw.parseRequest!({headers: {cookie: "sid=abc"}})
            k.set(undefined)
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Max-Age=0; Path=/api; Domain=.example.com; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("SameSite=None forces Secure", () => {
        inRequest(() => {
            const k = key("s_none")
            const mw = createCookieMiddleware(k, {cookieName: "sid", sameSite: "none", secure: false})
            k.set("t")
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=t; Path=/; SameSite=None; Secure; HttpOnly",
            ])
        })
    })

    test("multiple cookies append rather than overwrite", () => {
        inRequest(() => {
            const sid = key("s_multi_a")
            const csrf = key("s_multi_b")
            const sidMw = createCookieMiddleware(sid, {cookieName: "sid"})
            const csrfMw = createCookieMiddleware(csrf, {cookieName: "csrf"})
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
        inRequest(() => {
            const k = key("s_bad")
            const mw = createCookieMiddleware(k, {cookieName: "sid"})
            expect(() => mw.parseRequest!({headers: {cookie: "sid=%"}})).not.toThrow()
            expect(k.get()).toBe("%")
        })
    })

    test("fractional maxAgeSec is truncated", () => {
        inRequest(() => {
            const k = key("s_frac")
            const mw = createCookieMiddleware(k, {cookieName: "sid", maxAgeSec: 3.9})
            k.set("t")
            const res = newRes()
            mw.updateResponse!(res)
            expect(res.headers["set-cookie"]![0]).toContain("Max-Age=3")
        })
    })

    test("illegal name/path/domain and non-finite maxAge are rejected at construction", () => {
        expect(() => createCookieMiddleware(key("v1"), {cookieName: "a;b"})).toThrow()
        expect(() => createCookieMiddleware(key("v2"), {cookieName: "sid", path: "/x\r\nSet-Cookie: y=z"})).toThrow()
        expect(() => createCookieMiddleware(key("v3"), {cookieName: "sid", domain: "e;vil"})).toThrow()
        expect(() => createCookieMiddleware(key("v4"), {cookieName: "sid", maxAgeSec: NaN})).toThrow()
    })
})
