import {describe, expect, it} from "vitest";
import {
    FORBIDDEN,
    GG_ANY_PERMISSION,
    GG_NO_PERMISSIONS,
    IsString,
    NOT_AUTHORIZED,
    SERVER_ERROR,
} from "@grest-ts/schema";
import {GGSocketContractMethods, webSocketSchema} from "@grest-ts/websocket";
import {toAsyncApi} from "../src/toAsyncApi";

function makeWs(name: string, c2sPermission: any, opts: {connectPermission?: any} = {}) {
    const methods = {
        clientToServer: {
            send: {
                input: IsString,
                success: IsString,
                errors: c2sPermission === GG_NO_PERMISSIONS ? [SERVER_ERROR] : [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
                permission: c2sPermission,
            },
        },
        serverToClient: {
            push: {
                input: IsString,
                permission: GG_NO_PERMISSIONS,
            },
        },
    } satisfies GGSocketContractMethods;
    let builder = webSocketSchema(name).path(`ws/${name.toLowerCase()}`);
    if (opts.connectPermission !== undefined) {
        builder = builder.connectPermission(opts.connectPermission);
    }
    return builder.messages(methods);
}

function findOp(doc: any, suffix: string): any {
    for (const opId of Object.keys(doc.operations || {})) {
        if (opId.endsWith(suffix)) return doc.operations[opId];
    }
    return undefined;
}

describe("toAsyncApi — permission → security mapping", () => {

    it("GG_NO_PERMISSIONS on c2s → security: [] override (no scheme)", () => {
        const api = makeWs("PubWs", GG_NO_PERMISSIONS);
        const doc = toAsyncApi([api]);
        const op = findOp(doc, "_send_send");
        expect(op).toBeDefined();
        // [] is explicit "no security" — but AsyncAPI in this codebase omits the
        // field when the mapped requirements length is 0 (uniform with the s2c path).
        expect(op.security).toBeUndefined();
    });

    it("bare string scope on c2s → bearerAuth with scope", () => {
        const api = makeWs("ScopedWs", "chat:write");
        const doc = toAsyncApi([api]);
        const op = findOp(doc, "_send_send");
        expect(op.security).toEqual([{BearerAuth: ["chat:write"]}]);
        expect(doc.components?.securitySchemes?.BearerAuth).toMatchObject({type: "http", scheme: "bearer"});
    });

    it("GG_ANY_PERMISSION on c2s → bearerAuth with no scope list", () => {
        const api = makeWs("AnyWs", GG_ANY_PERMISSION);
        const doc = toAsyncApi([api]);
        const op = findOp(doc, "_send_send");
        expect(op.security).toEqual([{BearerAuth: []}]);
    });

    it("allOf on c2s → single requirement with multiple scopes", () => {
        const api = makeWs("AllWs", {allOf: ["a", "b"]});
        const doc = toAsyncApi([api]);
        const op = findOp(doc, "_send_send");
        expect(op.security).toEqual([{BearerAuth: ["a", "b"]}]);
    });

    it("anyOf on c2s → multiple requirements", () => {
        const api = makeWs("AnyOfWs", {anyOf: ["a", "b"]});
        const doc = toAsyncApi([api]);
        const op = findOp(doc, "_send_send");
        expect(op.security).toEqual([{BearerAuth: ["a"]}, {BearerAuth: ["b"]}]);
    });

    it("connectPermission applies channel-wide (visible on s2c too)", () => {
        const api = makeWs("ConnWs", GG_NO_PERMISSIONS, {connectPermission: "feature:connect"});
        const doc = toAsyncApi([api]);
        // s2c push picks up the channel security from connectPermission.
        const pushOp = findOp(doc, "_receive_push");
        expect(pushOp.security).toEqual([{BearerAuth: ["feature:connect"]}]);
    });

    it("per-method c2s permission overrides connectPermission on send op", () => {
        const api = makeWs("OverrideWs", "msg:write", {connectPermission: "channel:connect"});
        const doc = toAsyncApi([api]);
        const sendOp = findOp(doc, "_send_send");
        expect(sendOp.security).toEqual([{BearerAuth: ["msg:write"]}]);
        // s2c still uses channel security.
        const pushOp = findOp(doc, "_receive_push");
        expect(pushOp.security).toEqual([{BearerAuth: ["channel:connect"]}]);
    });
});
