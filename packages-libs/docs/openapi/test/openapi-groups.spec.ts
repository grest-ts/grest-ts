import {describe, it, expect, beforeEach} from "vitest";
import {
    IsString, IsNumber, IsObject, ERROR, GGContractClass, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {GGRpc, GGHttpSchema, GGHttpServer} from "@grest-ts/http";
import {GGOpenApiDocsGroups} from "../src/GGOpenApiDocsGroups";

const NOT_FOUND = ERROR.define("NOT_FOUND", 404);

const UserContract = new GGContractClass("UserApi", {
    get: {input: IsObject({id: IsNumber}), success: IsObject({id: IsNumber, name: IsString}), errors: [NOT_FOUND],
        permission: GG_NO_PERMISSIONS
    }
});
const ProfileContract = new GGContractClass("ProfileApi", {
    get: {input: IsObject({id: IsNumber}), success: IsObject({bio: IsString}), errors: [NOT_FOUND],
        permission: GG_NO_PERMISSIONS
    }
});
const OrderContract = new GGContractClass("OrderApi", {
    list: {success: IsObject({orders: IsString}), errors: [NOT_FOUND],
        permission: GG_NO_PERMISSIONS
    }
});

const UserApi    = new GGHttpSchema({contract: UserContract, pathPrefix: "api/users", routes: {get: GGRpc.GET(":id")}});
const ProfileApi = new GGHttpSchema({contract: ProfileContract, pathPrefix: "api/profiles", routes: {get: GGRpc.GET(":id")}});
const OrderApi   = new GGHttpSchema({contract: OrderContract, pathPrefix: "api/orders", routes: {list: GGRpc.GET("")}});

// Minimal stub of GGHttpServer.registerRoute — we only need to capture registrations.
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

describe("GGOpenApiDocsGroups", () => {

    let routes: Map<string, Function>;
    let server: GGHttpServer;
    beforeEach(() => {
        const stub = newStubServer();
        routes = stub.routes;
        server = stub.server;
    });

    it("registers one spec route per group + the docs HTML route", () => {
        new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi, ProfileApi], Orders: [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        });
        expect(routes.has("GET /openapi/users.json")).toBe(true);
        expect(routes.has("GET /openapi/orders.json")).toBe(true);
        expect(routes.has("GET /docs")).toBe(true);
    });

    it("each spec endpoint contains only its group's operations", async () => {
        new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi, ProfileApi], Orders: [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        });
        const usersSpec = JSON.parse((await callRoute(routes.get("GET /openapi/users.json")!)).body);
        const ordersSpec = JSON.parse((await callRoute(routes.get("GET /openapi/orders.json")!)).body);

        expect(Object.keys(usersSpec.paths)).toEqual(expect.arrayContaining(["/api/users/{id}", "/api/profiles/{id}"]));
        expect(Object.keys(usersSpec.paths)).not.toContain("/api/orders");
        expect(Object.keys(ordersSpec.paths)).toEqual(["/api/orders"]);
    });

    it("docs HTML embeds urls + primaryName from buildSwitcherConfig", async () => {
        new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi], Orders: [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
            primary: "Orders",
        });
        const html = (await callRoute(routes.get("GET /docs")!)).body;
        expect(html).toContain('"name":"Users"');
        expect(html).toContain('"url":"/openapi/users.json"');
        expect(html).toContain('"name":"Orders"');
        expect(html).toContain('"urls.primaryName"');
        expect(html).toContain('"Orders"');
    });

    it("combined: true serves /openapi/all.json with all schemas merged", async () => {
        new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi], Orders: [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
            combined: true,
        });
        expect(routes.has("GET /openapi/all.json")).toBe(true);
        const allSpec = JSON.parse((await callRoute(routes.get("GET /openapi/all.json")!)).body);
        expect(Object.keys(allSpec.paths)).toEqual(expect.arrayContaining(["/api/users/{id}", "/api/orders"]));
    });

    it("combined: true makes 'All APIs' the default primary when none specified", () => {
        const inst = new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi], Orders: [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
            combined: true,
        });
        expect(inst.buildSwitcherConfig().primaryName).toBe("All APIs");
        expect(inst.buildSwitcherConfig().urls[0]).toEqual({name: "All APIs", url: "/openapi/all.json"});
    });

    it("primary defaults to first key when omitted", () => {
        const inst = new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi], Orders: [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        });
        expect(inst.buildSwitcherConfig().primaryName).toBe("Users");
    });

    it("customUi receives the switcher config and its return is served verbatim", async () => {
        new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
            customUi: (config) => `<custom>${config.title} primary=${config.primaryName} count=${config.urls.length}</custom>`,
        });
        const html = (await callRoute(routes.get("GET /docs")!)).body;
        expect(html).toBe("<custom>API primary=Users count=1</custom>");
    });

    it("rejects empty groups", () => {
        expect(() => new GGOpenApiDocsGroups(server, {
            groups: {},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        })).toThrow(/at least one entry/);
    });

    it("rejects unknown primary", () => {
        expect(() => new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
            primary: "Other",
        })).toThrow(/primary.*must be a key/);
    });

    it("rejects duplicate group slugs", () => {
        expect(() => new GGOpenApiDocsGroups(server, {
            groups: {"User-Service": [UserApi], "user service": [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        })).toThrow(/duplicate slug/);
    });

    it("kebab-cases group names into URL slugs (camelCase + spaces)", () => {
        const inst = new GGOpenApiDocsGroups(server, {
            groups: {"UserAccounts": [UserApi], "Order Management": [OrderApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        });
        const urls = inst.buildSwitcherConfig().urls.map(u => u.url);
        expect(urls).toContain("/openapi/user-accounts.json");
        expect(urls).toContain("/openapi/order-management.json");
    });

    it("when cdnUrl is set, no asset routes are registered", () => {
        new GGOpenApiDocsGroups(server, {
            groups: {Users: [UserApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
            cdnUrl: "https://cdn.example.com/swagger",
        });
        const assetRoutes = [...routes.keys()].filter(k => k.includes("/assets/"));
        expect(assetRoutes).toHaveLength(0);
    });

    it("static register() requires an HTTP server (via options.http or locator)", () => {
        // Verifies the static is wired and surfaces the missing-server condition;
        // the actual error message depends on whether a locator scope is present.
        expect(() => GGOpenApiDocsGroups.register({
            groups: {Users: [UserApi]},
            specPathPrefix: "/openapi",
            docsPath: "/docs",
        })).toThrow();
    });
});
