import {describe, it, expect, beforeEach} from "vitest";
import {IsString, IsObject, SERVER_ERROR, GG_NO_PERMISSIONS, GGDuplexContract } from "@grest-ts/schema";
import {GGHttpServer} from "@grest-ts/http";
import {GGWebSocketSchema} from "@grest-ts/websocket";
import {GGAsyncApiDocsGroups} from "../src/GGAsyncApiDocsGroups";

const ChatContract = new GGDuplexContract("ChatApi", {
    connect: {},
    clientToServer: {
        send: {input: IsObject({text: IsString}), success: IsObject({id: IsString}), errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        }
    },
    serverToClient: {
        onMessage: {input: IsObject({text: IsString}),
            permission: GG_NO_PERMISSIONS
        }
    }
});
const NotificationContract = new GGDuplexContract("NotificationApi", {
    connect: {},
    clientToServer: {
        subscribe: {input: IsObject({topic: IsString}), success: IsObject({ok: IsString}), errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        }
    },
    serverToClient: {
        onPush: {input: IsObject({title: IsString}),
            permission: GG_NO_PERMISSIONS
        }
    }
});

const ChatApiSchema = new GGWebSocketSchema({contract: ChatContract, path: "ws/chat"});
const NotificationApiSchema = new GGWebSocketSchema({contract: NotificationContract, path: "ws/notifications"});

function newStubServer(): {routes: Map<string, Function>, server: GGHttpServer} {
    const routes = new Map<string, Function>();
    const server = {
        registerRoute(method: string, path: string, handler: Function) {
            routes.set(`${method} ${path}`, handler);
        }
    } as unknown as GGHttpServer;
    return {routes, server};
}

async function callRoute(handler: Function): Promise<{status: number, body: string, headers: Record<string, any>}> {
    return await new Promise(resolve => {
        let status = 0;
        let body = "";
        let headers: Record<string, any> = {};
        const res = {
            writeHead(s: number, h: Record<string, any>) { status = s; headers = h; },
            end(b: string) { body = b; resolve({status, body, headers}); }
        };
        handler({}, res);
    });
}

describe("GGAsyncApiDocsGroups", () => {
    let routes: Map<string, Function>;
    let server: GGHttpServer;
    beforeEach(() => {
        const stub = newStubServer();
        routes = stub.routes;
        server = stub.server;
    });

    it("registers one spec route per group + the docs HTML route + wildcard", () => {
        new GGAsyncApiDocsGroups(server, {
            groups: {Chat: [ChatApiSchema], Notifications: [NotificationApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
        });
        expect(routes.has("GET /asyncapi/chat.json")).toBe(true);
        expect(routes.has("GET /asyncapi/notifications.json")).toBe(true);
        expect(routes.has("GET /asyncapi-docs")).toBe(true);
        expect(routes.has("GET /asyncapi-docs/*")).toBe(true);
    });

    it("each spec endpoint contains only its group's channels", async () => {
        new GGAsyncApiDocsGroups(server, {
            groups: {Chat: [ChatApiSchema], Notifications: [NotificationApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
        });
        const chatSpec = JSON.parse((await callRoute(routes.get("GET /asyncapi/chat.json")!)).body);
        const notifSpec = JSON.parse((await callRoute(routes.get("GET /asyncapi/notifications.json")!)).body);

        expect(Object.keys(chatSpec.channels)).toEqual(["ChatApi"]);
        expect(Object.keys(notifSpec.channels)).toEqual(["NotificationApi"]);
    });

    it("docs HTML embeds a select with one option per group", async () => {
        new GGAsyncApiDocsGroups(server, {
            groups: {Chat: [ChatApiSchema], Notifications: [NotificationApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
            primary: "Notifications",
        });
        const html = (await callRoute(routes.get("GET /asyncapi-docs")!)).body;
        expect(html).toContain('<select id="gg-spec-switcher">');
        expect(html).toContain('value="/asyncapi/chat.json"');
        expect(html).toContain('value="/asyncapi/notifications.json" selected');
    });

    it("primary defaults to first group when omitted", () => {
        const inst = new GGAsyncApiDocsGroups(server, {
            groups: {Chat: [ChatApiSchema], Notifications: [NotificationApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
        });
        expect(inst.buildSwitcherConfig().primaryName).toBe("Chat");
    });

    it("customUi receives the switcher config and its return is served verbatim", async () => {
        new GGAsyncApiDocsGroups(server, {
            groups: {Chat: [ChatApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
            customUi: (config) => `<custom>${config.title} primary=${config.primaryName} count=${config.urls.length}</custom>`,
        });
        const html = (await callRoute(routes.get("GET /asyncapi-docs")!)).body;
        expect(html).toBe("<custom>API primary=Chat count=1</custom>");
    });

    it("rejects empty groups", () => {
        expect(() => new GGAsyncApiDocsGroups(server, {
            groups: {},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
        })).toThrow(/at least one entry/);
    });

    it("rejects unknown primary", () => {
        expect(() => new GGAsyncApiDocsGroups(server, {
            groups: {Chat: [ChatApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
            primary: "Other",
        })).toThrow(/primary.*must be a key/);
    });

    it("rejects duplicate group slugs", () => {
        expect(() => new GGAsyncApiDocsGroups(server, {
            groups: {"Chat-Service": [ChatApiSchema], "chat service": [NotificationApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
        })).toThrow(/duplicate slug/);
    });

    it("static register() requires an HTTP server (via options.http or locator)", () => {
        expect(() => GGAsyncApiDocsGroups.register({
            groups: {Chat: [ChatApiSchema]},
            specPathPrefix: "/asyncapi",
            docsPath: "/asyncapi-docs",
        })).toThrow();
    });
});
