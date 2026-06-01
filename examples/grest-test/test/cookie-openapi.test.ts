import {describe, expect, test} from "vitest";
import {GG_NO_PERMISSIONS, GGContractClass, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema";
import {GGCookie, GGHeader, GGRpc, httpSchema} from "@grest-ts/http";
import {toOpenApi} from "@grest-ts/openapi";

const Contract = new GGContractClass("WhoAmI", {
    whoami: {success: IsString, errors: [NOT_AUTHORIZED, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
});

const CookieApi = httpSchema(Contract)
    .pathPrefix("c")
    .use(new GGCookie("access"))
    .routes({whoami: GGRpc.GET("whoami")});

const HeaderApi = httpSchema(Contract)
    .pathPrefix("h")
    .use(new GGHeader("authorization", {scheme: "bearer"}))
    .routes({whoami: GGRpc.GET("whoami")});

const paramsOf = (schema: any, path: string) => {
    const doc = toOpenApi([schema], {title: "t", version: "1.0.0"});
    const op = (doc.paths as any)[path]?.get;
    return (op?.parameters ?? []) as Array<{name: string; in: string; required?: boolean; schema?: any}>;
};

describe("cookie() / header() OpenAPI params", () => {

    test("a cookie wire is documented as an in:cookie param", () => {
        const params = paramsOf(CookieApi, "/c/whoami");
        expect(params).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "access", in: "cookie"}),
        ]));
        expect(params.some(p => p.in === "header")).toBe(false);
    });

    test("a header wire is documented as an in:header param", () => {
        const params = paramsOf(HeaderApi, "/h/whoami");
        expect(params).toEqual(expect.arrayContaining([
            expect.objectContaining({name: "authorization", in: "header"}),
        ]));
        expect(params.some(p => p.in === "cookie")).toBe(false);
    });
});
