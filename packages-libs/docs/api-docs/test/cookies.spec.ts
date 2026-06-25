import {describe, expect, it} from "vitest";
import {GG_NO_PERMISSIONS, GGContractClass, GGDuplexContract, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema";
import {GGCookie, GGHeader, GGRpc, GGHttpSchema} from "@grest-ts/http";
import {GGWebSocketSchema} from "@grest-ts/websocket";
import {buildContractDoc} from "../src/buildContractDoc";

function findContract(doc: ReturnType<typeof buildContractDoc>, name: string) {
    for (const group of doc.groups) {
        for (const c of group.contracts) if (c.name === name) return c;
    }
    return undefined;
}

describe("buildContractDoc — cookie surfacing", () => {

    it("HTTP cookie() binding is documented under cookies, not headers", () => {
        const C = new GGContractClass("CookieHttp", {
            me: {success: IsString, errors: [NOT_AUTHORIZED, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "acct", use: [new GGCookie("access")], routes: {me: GGRpc.GET("me")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const c = findContract(doc, "CookieHttp");
        expect(c?.cookies?.map(x => x.name)).toEqual(["access"]);
        expect(c?.headers ?? []).toEqual([]);
    });

    it("a custom cookie name is surfaced", () => {
        const C = new GGContractClass("CookieNamed", {
            me: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "acct2", use: [new GGCookie("sid")], routes: {me: GGRpc.GET("me")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        expect(findContract(doc, "CookieNamed")?.cookies?.map(x => x.name)).toEqual(["sid"]);
    });

    it("a header() binding does NOT populate cookies", () => {
        const C = new GGContractClass("HeaderOnly", {
            me: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "h", use: [new GGHeader("x-access")], routes: {me: GGRpc.GET("me")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const c = findContract(doc, "HeaderOnly");
        expect(c?.cookies ?? []).toEqual([]);
        expect(c?.headers?.map(x => x.name)).toEqual(["x-access"]);
    });

    it("WS cookie() binding is surfaced on the connection contract", () => {
        const C = new GGDuplexContract("CookieWs", {
            connect: {},
            clientToServer: {whoami: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS}},
            serverToClient: {},
        });
        const Api = new GGWebSocketSchema({contract: C, path: "ws/acct", use: [new GGCookie("access")]});
        const doc = buildContractDoc({title: "T", groups: {default: {ws: [Api]}}});
        expect(findContract(doc, "CookieWs")?.cookies?.map(x => x.name)).toEqual(["access"]);
    });
});
