import {describe, it, expect, beforeEach} from "vitest";
import {IsString, IsObject, ERROR, SERVER_ERROR, GGContractClass} from "@grest-ts/schema";
import {GGRpc, httpSchema, GGHttpServer} from "@grest-ts/http";
import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket";
import {GGApiDocs} from "../src/GGApiDocs";

const NOT_FOUND = ERROR.define("NOT_FOUND", 404);

const UserContract = new GGContractClass("UserApi", {
    get: {input: IsObject({id: IsString}), success: IsObject({name: IsString}), errors: [NOT_FOUND]}
});
const OrderContract = new GGContractClass("OrderApi", {
    list: {success: IsObject({items: IsString}), errors: [NOT_FOUND]}
});
const UserApi  = httpSchema(UserContract).pathPrefix("api/users").routes({get: GGRpc.GET(":id")});
const OrderApi = httpSchema(OrderContract).pathPrefix("api/orders").routes({list: GGRpc.GET("")});

const ChatContract = defineSocketContract("ChatApi", {
    clientToServer: {send: {input: IsObject({text: IsString}), success: IsObject({id: IsString}), errors: [SERVER_ERROR]}},
    serverToClient: {onMessage: {input: IsObject({text: IsString})}}
});
const ChatApiSchema = webSocketSchema(ChatContract).path("ws/chat").done();

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

describe("GGApiDocs (live mode)", () => {
    let routes: Map<string, Function>;
    let server: GGHttpServer;
    beforeEach(() => {
        const stub = newStubServer();
        routes = stub.routes;
        server = stub.server;
    });

    it("registers the expected route shape", () => {
        new GGApiDocs(server, {
            title: "MyOrg",
            docsPath: "/docs",
            groups: {
                Users:  {http: [UserApi], ws: [ChatApiSchema]},
                Orders: {http: [OrderApi]},
            }
        });

        expect(routes.has("GET /docs")).toBe(true);
        expect(routes.has("GET /docs/manifest.json")).toBe(true);
        expect(routes.has("GET /docs/specs/users/openapi.json")).toBe(true);
        expect(routes.has("GET /docs/specs/users/asyncapi.json")).toBe(true);
        expect(routes.has("GET /docs/specs/orders/openapi.json")).toBe(true);
        // No WS for orders → no asyncapi route
        expect(routes.has("GET /docs/specs/orders/asyncapi.json")).toBe(false);
    });

    it("registers bundled asset routes when no cdnUrl/customUi", () => {
        new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}}
        });
        expect(routes.has("GET /docs/assets/swagger-ui-bundle.js")).toBe(true);
        expect(routes.has("GET /docs/assets/swagger-ui.css")).toBe(true);
        expect(routes.has("GET /docs/assets/asyncapi-component.js")).toBe(true);
        expect(routes.has("GET /docs/assets/asyncapi-component.css")).toBe(true);
        expect(routes.has("GET /docs/assets/shell.js")).toBe(true);
        expect(routes.has("GET /docs/assets/shell.css")).toBe(true);
    });

    it("manifest endpoint serves the buildManifest output", async () => {
        new GGApiDocs(server, {
            title: "MyOrg", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}}
        });
        const r = await callRoute(routes.get("GET /docs/manifest.json")!);
        expect(r.status).toBe(200);
        expect(r.headers["Content-Type"]).toBe("application/json");
        const m = JSON.parse(r.body);
        expect(m.title).toBe("MyOrg");
        expect(m.groups[0].slug).toBe("users");
    });

    it("openapi endpoint returns a valid spec for the group", async () => {
        new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}, Orders: {http: [OrderApi]}}
        });
        const usersBody = (await callRoute(routes.get("GET /docs/specs/users/openapi.json")!)).body;
        const usersSpec = JSON.parse(usersBody);
        expect(usersSpec.openapi).toBe("3.1.0");
        expect(Object.keys(usersSpec.paths)).toContain("/api/users/{id}");
        expect(Object.keys(usersSpec.paths)).not.toContain("/api/orders");
    });

    it("asyncapi endpoint returns a valid spec for the group", async () => {
        new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            groups: {Realtime: {ws: [ChatApiSchema]}}
        });
        const body = (await callRoute(routes.get("GET /docs/specs/realtime/asyncapi.json")!)).body;
        const spec = JSON.parse(body);
        expect(spec.asyncapi).toBe("3.0.0");
        expect(Object.keys(spec.channels)).toEqual(["ChatApi"]);
    });

    it("shell HTML embeds the manifest inline", async () => {
        new GGApiDocs(server, {
            title: "MyOrg", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}}
        });
        const html = (await callRoute(routes.get("GET /docs")!)).body;
        expect(html).toContain('id="gg-manifest"');
        expect(html).toContain('"title":"MyOrg"');
        expect(html).toContain('"slug":"users"');
        expect(html).toContain("/docs/assets/shell.js");
        expect(html).toContain("/docs/assets/swagger-ui.css");
    });

    it("cdnUrl.swaggerUi skips bundled swagger asset routes and rewrites HTML refs", async () => {
        new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}},
            cdnUrl: {swaggerUi: "https://cdn.example.com/swagger"},
        });
        expect(routes.has("GET /docs/assets/swagger-ui-bundle.js")).toBe(false);
        expect(routes.has("GET /docs/assets/swagger-ui.css")).toBe(false);
        // Other assets stay
        expect(routes.has("GET /docs/assets/asyncapi-component.js")).toBe(true);
        expect(routes.has("GET /docs/assets/shell.js")).toBe(true);

        const html = (await callRoute(routes.get("GET /docs")!)).body;
        expect(html).toContain("https://cdn.example.com/swagger/swagger-ui-bundle.js");
        expect(html).toContain("https://cdn.example.com/swagger/swagger-ui.css");
    });

    it("customUi receives the manifest and its return is served verbatim; no asset routes", async () => {
        new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}},
            customUi: (m) => `<custom>${m.title} groups=${m.groups.length}</custom>`,
        });
        // No asset routes when customUi is set
        const assetRoutes = [...routes.keys()].filter(k => k.includes("/assets/"));
        expect(assetRoutes).toHaveLength(0);

        const html = (await callRoute(routes.get("GET /docs")!)).body;
        expect(html).toBe("<custom>X groups=1</custom>");
    });

    it("getSpec() caches", () => {
        const docs = new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}}
        });
        const first = docs.getSpec("Users", "openapi");
        const second = docs.getSpec("Users", "openapi");
        expect(first).toBe(second);
    });

    it("eager mode pre-builds all specs at construction", () => {
        // Should not throw — build runs synchronously during construction.
        expect(() => new GGApiDocs(server, {
            title: "X", docsPath: "/docs",
            eager: true,
            groups: {Users: {http: [UserApi], ws: [ChatApiSchema]}}
        })).not.toThrow();
    });

    it("static register requires an HTTP server", () => {
        expect(() => GGApiDocs.register({
            title: "X", docsPath: "/docs",
            groups: {Users: {http: [UserApi]}}
        })).toThrow();
    });
});
