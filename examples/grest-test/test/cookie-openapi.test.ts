/**
 * Cookie-bound inputs are now documentable: the cookie() binding emits `in: cookie`
 * OpenAPI parameters, closing the gap where cookie-authed APIs showed nothing. The
 * matching header wiring emits `in: header` params from the same logical contract.
 */
import {toOpenApi} from "@grest-ts/openapi"
import {AccountHttpCookie, AccountHttpHeader} from "../src/api/wire-symmetry/wiring"

const paramsOf = (schema: any, path: string) => {
    const doc = toOpenApi([schema], {title: "t", version: "1.0.0"})
    const op = (doc.paths as any)[path]?.get
    return (op?.parameters ?? []) as Array<{name: string; in: string}>
}

describe("cookie() OpenAPI params", () => {

    test("the cookie wiring documents its cookies as in:cookie params", () => {
        const params = paramsOf(AccountHttpCookie, "/wire/c/whoami")
        expect(params).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "access", in: "cookie"}),
            expect.objectContaining({name: "locale", in: "cookie"}),
        ]))
        expect(params.some(p => p.in === "header")).toBe(false)
    })

    test("the header wiring documents the same inputs as in:header params", () => {
        const params = paramsOf(AccountHttpHeader, "/wire/h/whoami")
        expect(params).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "authorization", in: "header"}),
            expect.objectContaining({name: "x-locale", in: "header"}),
        ]))
        expect(params.some(p => p.in === "cookie")).toBe(false)
    })
})
