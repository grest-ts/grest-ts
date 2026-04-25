import {describe, it, expect} from "vitest";
import {IsString, IsObject, ERROR, SERVER_ERROR, GGContractClass} from "@grest-ts/schema";
import {GGRpc, httpSchema} from "@grest-ts/http";
import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket";
import {buildManifest, toSlug} from "../src/manifest";

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

describe("buildManifest", () => {

    it("builds from grouped input with mixed http/ws", () => {
        const manifest = buildManifest({
            title: "MyOrg",
            groups: {
                "Users":  {http: [UserApi], ws: [ChatApiSchema]},
                "Orders": {http: [OrderApi]},
            }
        }, "/docs");

        expect(manifest.title).toBe("MyOrg");
        expect(manifest.groups).toHaveLength(2);
        expect(manifest.groups[0]).toEqual({
            name: "Users",
            slug: "users",
            specs: [
                {type: "openapi",  label: "HTTP",      url: "/docs/specs/users/openapi.json"},
                {type: "asyncapi", label: "WebSocket", url: "/docs/specs/users/asyncapi.json"},
            ]
        });
        expect(manifest.groups[1].specs).toEqual([
            {type: "openapi", label: "HTTP", url: "/docs/specs/orders/openapi.json"}
        ]);
    });

    it("builds from ungrouped (top-level http/ws) input as a single 'API' group", () => {
        const manifest = buildManifest({
            title: "Solo",
            http: [UserApi],
            ws:   [ChatApiSchema],
        }, "/docs");
        expect(manifest.groups).toHaveLength(1);
        expect(manifest.groups[0].name).toBe("API");
        expect(manifest.groups[0].specs).toHaveLength(2);
    });

    it("uses relative URLs when baseUrl is empty (static-build mode)", () => {
        const manifest = buildManifest({
            title: "Static",
            groups: {Users: {http: [UserApi]}}
        }, ".");
        expect(manifest.groups[0].specs[0].url).toBe("./specs/users/openapi.json");
    });

    it("only emits openapi entry for groups with http schemas only", () => {
        const manifest = buildManifest({
            title: "X",
            groups: {Users: {http: [UserApi]}}
        }, "/docs");
        expect(manifest.groups[0].specs).toEqual([
            {type: "openapi", label: "HTTP", url: "/docs/specs/users/openapi.json"}
        ]);
    });

    it("only emits asyncapi entry for ws-only groups", () => {
        const manifest = buildManifest({
            title: "X",
            groups: {Realtime: {ws: [ChatApiSchema]}}
        }, "/docs");
        expect(manifest.groups[0].specs).toEqual([
            {type: "asyncapi", label: "WebSocket", url: "/docs/specs/realtime/asyncapi.json"}
        ]);
    });

    it("primary defaults to undefined; first group is implied at the consumer side", () => {
        const m = buildManifest({title: "X", groups: {A: {http: [UserApi]}, B: {http: [OrderApi]}}}, "/docs");
        expect(m.primary).toBeUndefined();
    });

    it("primary is preserved when set", () => {
        const m = buildManifest({
            title: "X",
            primary: "B",
            groups: {A: {http: [UserApi]}, B: {http: [OrderApi]}}
        }, "/docs");
        expect(m.primary).toBe("B");
    });

    it("rejects unknown primary", () => {
        expect(() => buildManifest({
            title: "X",
            primary: "Nope",
            groups: {A: {http: [UserApi]}}
        }, "/docs")).toThrow(/primary.*must be a group name/);
    });

    it("rejects empty group with no schemas", () => {
        expect(() => buildManifest({
            title: "X",
            groups: {Users: {}}
        }, "/docs")).toThrow(/no http or ws schemas/);
    });

    it("rejects no schemas at all", () => {
        expect(() => buildManifest({title: "X"}, "/docs")).toThrow(/no schemas/);
    });

    it("rejects duplicate slugs", () => {
        expect(() => buildManifest({
            title: "X",
            groups: {"User-Service": {http: [UserApi]}, "user service": {http: [OrderApi]}}
        }, "/docs")).toThrow(/duplicate slug/);
    });

    it("preserves group description and branding", () => {
        const m = buildManifest({
            title: "X",
            description: "platform overview",
            version: "1.2.3",
            branding: {primaryColor: "#ff0000", logoUrl: "/logo.png"},
            groups: {Users: {description: "user APIs", http: [UserApi]}}
        }, "/docs");
        expect(m.description).toBe("platform overview");
        expect(m.version).toBe("1.2.3");
        expect(m.branding).toEqual({primaryColor: "#ff0000", logoUrl: "/logo.png"});
        expect(m.groups[0].description).toBe("user APIs");
    });
});

describe("toSlug", () => {
    it.each([
        ["Users", "users"],
        ["UserAccounts", "user-accounts"],
        ["Order Management", "order-management"],
        ["Realtime!! Notifications", "realtime-notifications"],
        ["__weird__", "weird"],
    ])("kebab-cases %j → %j", (input, expected) => {
        expect(toSlug(input)).toBe(expected);
    });
});
