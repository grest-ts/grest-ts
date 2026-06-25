import {describe, expect, it} from "vitest";
import {
    FORBIDDEN,
    GG_ANY_PERMISSION,
    GG_NO_PERMISSIONS,
    GGContractClass,
    GGDuplexContract,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema";
import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {GGWebSocketSchema} from "@grest-ts/websocket";
import {buildContractDoc} from "../src/buildContractDoc";

function findMethod(doc: ReturnType<typeof buildContractDoc>, contractName: string, methodName: string) {
    for (const group of doc.groups) {
        for (const c of group.contracts) {
            if (c.name === contractName) {
                return c.methods.find(m => m.name === methodName);
            }
        }
    }
    return undefined;
}

function findContract(doc: ReturnType<typeof buildContractDoc>, contractName: string) {
    for (const group of doc.groups) {
        for (const c of group.contracts) {
            if (c.name === contractName) return c;
        }
    }
    return undefined;
}

describe("buildContractDoc — permission rendering", () => {

    it("HTTP method picks up GG_NO_PERMISSIONS as public", () => {
        const C = new GGContractClass("Pub", {
            ping: {success: IsString, errors: [SERVER_ERROR], permission: GG_NO_PERMISSIONS},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "pub", routes: {ping: GGRpc.GET("ping")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const m = findMethod(doc, "Pub", "ping");
        expect(m?.permission).toEqual({
            tree: {kind: "public"},
            text: "Public — no authentication required.",
        });
    });

    it("HTTP method picks up GG_ANY_PERMISSION", () => {
        const C = new GGContractClass("Any", {
            x: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: GG_ANY_PERMISSION},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "any", routes: {x: GGRpc.GET("x")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const m = findMethod(doc, "Any", "x");
        expect(m?.permission?.tree).toEqual({kind: "anyAuth"});
        expect(m?.permission?.text).toBe("Any authenticated identity.");
    });

    it("HTTP method renders single scope", () => {
        const C = new GGContractClass("S", {
            x: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: "items:read"},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "s", routes: {x: GGRpc.GET("x")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const m = findMethod(doc, "S", "x");
        expect(m?.permission?.tree).toEqual({kind: "scope", scope: "items:read"});
        expect(m?.permission?.text).toBe("Requires `items:read`.");
    });

    it("HTTP method renders allOf in plain English", () => {
        const C = new GGContractClass("All", {
            x: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: {allOf: ["a", "b"]}},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "all", routes: {x: GGRpc.GET("x")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const m = findMethod(doc, "All", "x");
        expect(m?.permission?.text).toBe("Requires `a` **and** `b`.");
    });

    it("HTTP method renders anyOf in plain English", () => {
        const C = new GGContractClass("AnyO", {
            x: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: {anyOf: ["a", "b"]}},
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "anyo", routes: {x: GGRpc.GET("x")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const m = findMethod(doc, "AnyO", "x");
        expect(m?.permission?.text).toBe("Requires `a` **or** `b`.");
    });

    it("HTTP method renders nested combinator", () => {
        const C = new GGContractClass("Nest", {
            x: {
                success: IsString,
                errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
                permission: {anyOf: [{allOf: ["a", "b"]}, "c"]},
            },
        });
        const Api = new GGHttpSchema({contract: C as any, pathPrefix: "nest", routes: {x: GGRpc.GET("x")}});
        const doc = buildContractDoc({title: "T", groups: {default: {http: [Api]}}});
        const m = findMethod(doc, "Nest", "x");
        expect(m?.permission?.text).toBe("Requires (`a` **and** `b`) **or** `c`.");
    });

    it("WS clientToServer method gets permission; serverToClient does not", () => {
        const C = new GGDuplexContract("Sock", {
            connect: {},
            clientToServer: {
                send: {input: IsString, success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: "chat:write"},
            },
            serverToClient: {
                push: {input: IsString, permission: GG_NO_PERMISSIONS},
            },
        });
        const Api = new GGWebSocketSchema({contract: C, path: "ws/sock"});
        const doc = buildContractDoc({title: "T", groups: {default: {ws: [Api]}}});
        const sendDoc = findMethod(doc, "Sock", "send");
        const pushDoc = findMethod(doc, "Sock", "push");
        expect(sendDoc?.permission?.text).toBe("Requires `chat:write`.");
        // s2c methods do not carry a documented permission — the gate has no
        // caller identity to check against on a server push.
        expect(pushDoc?.permission).toBeUndefined();
    });

    it("WS schema.connectPermission propagates to ContractDoc", () => {
        const C = new GGDuplexContract("Feat", {
            connect: {permission: {anyOf: ["admin", "owner"]}, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR]},
            clientToServer: {
                ping: {success: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: "chat:read"},
            },
            serverToClient: {},
        });
        const Api = new GGWebSocketSchema({contract: C, path: "ws/feat"});
        const doc = buildContractDoc({title: "T", groups: {default: {ws: [Api]}}});
        const contractDoc = findContract(doc, "Feat");
        expect(contractDoc?.connectPermission?.text).toBe("Requires `admin` **or** `owner`.");
    });
});
