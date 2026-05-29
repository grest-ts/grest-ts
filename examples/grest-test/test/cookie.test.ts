import {GGCookie, GG_DECLARED_COOKIES} from "@grest-ts/http"
import {GGContext} from "@grest-ts/context"
import {SERVER_ERROR} from "@grest-ts/schema"

function inRequest(declared: string[], fn: () => void): void {
    new GGContext("test").run(() => {
        GG_DECLARED_COOKIES.set(new Set(declared))
        fn()
    })
}

describe("GGCookie", () => {

    test("issue emits Set-Cookie with safe defaults + per-mint maxAge", () => {
        inRequest(["sid"], () => {
            const sid = new GGCookie("sid")
            sid.issue("token123", {maxAgeSec: 3600})
            const res = {headers: {} as Record<string, string | string[]>}
            sid.updateResponse(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=token123; Path=/; Max-Age=3600; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("clear emits Max-Age=0", () => {
        inRequest(["sid"], () => {
            const sid = new GGCookie("sid")
            sid.clear()
            const res = {headers: {} as Record<string, string | string[]>}
            sid.updateResponse(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("multiple cookies append rather than overwrite", () => {
        inRequest(["sid", "csrf"], () => {
            const sid = new GGCookie("sid")
            const csrf = new GGCookie("csrf")
            sid.issue("a")
            csrf.issue("b")
            const res = {headers: {} as Record<string, string | string[]>}
            sid.updateResponse(res)
            csrf.updateResponse(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=a; Path=/; SameSite=Lax; Secure; HttpOnly",
                "csrf=b; Path=/; SameSite=Lax; Secure; HttpOnly",
            ])
        })
    })

    test("SameSite=None forces Secure", () => {
        inRequest(["sid"], () => {
            const sid = new GGCookie("sid")
            sid.issue("t", {sameSite: "none", secure: false})
            const res = {headers: {} as Record<string, string | string[]>}
            sid.updateResponse(res)
            expect(res.headers["set-cookie"]).toEqual([
                "sid=t; Path=/; SameSite=None; Secure; HttpOnly",
            ])
        })
    })

    test("parseRequest reads the named cookie into context", () => {
        inRequest(["sid"], () => {
            const sid = new GGCookie("sid")
            sid.parseRequest({headers: {cookie: "other=x; sid=abc123; foo=y"}})
            expect(sid.get()).toBe("abc123")
        })
    })

    test("no intent staged -> updateResponse emits nothing", () => {
        inRequest(["sid"], () => {
            const sid = new GGCookie("sid")
            sid.parseRequest({headers: {cookie: "sid=incoming"}})
            const res = {headers: {} as Record<string, string | string[]>}
            sid.updateResponse(res)
            expect(res.headers["set-cookie"]).toBeUndefined()
        })
    })

    test("issue on a route that did not declare the cookie throws SERVER_ERROR", () => {
        inRequest([], () => {
            const sid = new GGCookie("sid")
            let err: unknown
            try {
                sid.issue("x")
            } catch (e) {
                err = e
            }
            expect(err).toBeInstanceOf(SERVER_ERROR)
            expect((err as SERVER_ERROR).getDebugContext()?.debugMessage).toContain("did not declare")
        })
    })

    describe("hardening", () => {

        test("malformed percent-encoding in the cookie value does not throw", () => {
            inRequest(["sid"], () => {
                const sid = new GGCookie("sid")
                expect(() => sid.parseRequest({headers: {cookie: "sid=%"}})).not.toThrow()
                expect(sid.get()).toBe("%")
            })
        })

        test("clear() reuses the definition's Path/Domain so the cookie is actually deletable", () => {
            inRequest(["sid"], () => {
                const sid = new GGCookie({cookieName: "sid", path: "/api", domain: ".example.com"})
                sid.clear()
                const res = {headers: {} as Record<string, string | string[]>}
                sid.updateResponse(res)
                expect(res.headers["set-cookie"]).toEqual([
                    "sid=; Path=/api; Domain=.example.com; Max-Age=0; SameSite=Lax; Secure; HttpOnly",
                ])
            })
        })

        test("issue() uses the definition's Path", () => {
            inRequest(["sid"], () => {
                const sid = new GGCookie({cookieName: "sid", path: "/api"})
                sid.issue("t")
                const res = {headers: {} as Record<string, string | string[]>}
                sid.updateResponse(res)
                expect(res.headers["set-cookie"]).toEqual([
                    "sid=t; Path=/api; SameSite=Lax; Secure; HttpOnly",
                ])
            })
        })

        test("non-finite maxAgeSec throws; fractional is truncated", () => {
            inRequest(["sid"], () => {
                const sid = new GGCookie("sid")
                expect(() => sid.issue("t", {maxAgeSec: NaN})).toThrow()
                expect(() => sid.issue("t", {maxAgeSec: Infinity})).toThrow()
                sid.issue("t", {maxAgeSec: 3.9})
                const res = {headers: {} as Record<string, string | string[]>}
                sid.updateResponse(res)
                expect(res.headers["set-cookie"]![0]).toContain("Max-Age=3")
            })
        })

        test("illegal characters in name/path/domain are rejected at construction", () => {
            expect(() => new GGCookie("a;b")).toThrow()
            expect(() => new GGCookie({cookieName: "sid", path: "/x\r\nSet-Cookie: y=z"})).toThrow()
            expect(() => new GGCookie({cookieName: "sid", domain: "e;vil"})).toThrow()
        })
    })
})
