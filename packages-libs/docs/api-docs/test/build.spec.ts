import {describe, it, expect, beforeEach, afterEach} from "vitest";
import {mkdtempSync, readFileSync, rmSync, existsSync, readdirSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {IsString, IsObject, ERROR, SERVER_ERROR, GGContractClass} from "@grest-ts/schema";
import {GGRpc, httpSchema} from "@grest-ts/http";
import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket";
import {buildApiDocs} from "../src/buildApiDocs";

const NOT_FOUND = ERROR.define("NOT_FOUND", 404);

const UserContract = new GGContractClass("UserApi", {
    get: {input: IsObject({id: IsString}), success: IsObject({name: IsString}), errors: [NOT_FOUND]}
});
const UserApi = httpSchema(UserContract).pathPrefix("api/users").routes({get: GGRpc.GET(":id")});

const ChatContract = defineSocketContract("ChatApi", {
    clientToServer: {send: {input: IsObject({text: IsString}), success: IsObject({id: IsString}), errors: [SERVER_ERROR]}},
    serverToClient: {onMessage: {input: IsObject({text: IsString})}}
});
const ChatApiSchema = webSocketSchema(ChatContract).path("ws/chat").done();

describe("buildApiDocs (static mode)", () => {
    let outDir: string;
    beforeEach(() => { outDir = mkdtempSync(join(tmpdir(), "gg-api-docs-")); });
    afterEach(() => { rmSync(outDir, {recursive: true, force: true}); });

    it("writes the expected file tree", async () => {
        await buildApiDocs({
            title: "MyOrg",
            outDir,
            groups: {
                Users: {http: [UserApi], ws: [ChatApiSchema]},
            }
        });

        expect(existsSync(join(outDir, "index.html"))).toBe(true);
        expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
        expect(existsSync(join(outDir, "specs", "users", "openapi.json"))).toBe(true);
        expect(existsSync(join(outDir, "specs", "users", "asyncapi.json"))).toBe(true);

        const assets = readdirSync(join(outDir, "assets")).sort();
        expect(assets).toEqual([
            "asyncapi-component.css",
            "asyncapi-component.js",
            "shell.css",
            "shell.js",
            "swagger-ui-bundle.js",
            "swagger-ui.css",
        ]);
    });

    it("manifest.json uses relative URLs", async () => {
        await buildApiDocs({
            title: "X", outDir,
            groups: {Users: {http: [UserApi]}}
        });
        const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf-8"));
        expect(manifest.groups[0].specs[0].url).toBe("./specs/users/openapi.json");
    });

    it("specs match what live mode would produce", async () => {
        await buildApiDocs({
            title: "X", outDir,
            groups: {Users: {http: [UserApi]}}
        });
        const spec = JSON.parse(readFileSync(join(outDir, "specs", "users", "openapi.json"), "utf-8"));
        expect(spec.openapi).toBe("3.1.0");
        expect(Object.keys(spec.paths)).toContain("/api/users/{id}");
    });

    it("does not emit openapi for ws-only groups (and vice versa)", async () => {
        await buildApiDocs({
            title: "X", outDir,
            groups: {Realtime: {ws: [ChatApiSchema]}}
        });
        expect(existsSync(join(outDir, "specs", "realtime", "asyncapi.json"))).toBe(true);
        expect(existsSync(join(outDir, "specs", "realtime", "openapi.json"))).toBe(false);
    });

    it("cdnUrl set for both viewers → no assets/ directory", async () => {
        await buildApiDocs({
            title: "X", outDir,
            groups: {Users: {http: [UserApi], ws: [ChatApiSchema]}},
            cdnUrl: {
                swaggerUi: "https://cdn.example.com/swagger",
                asyncApi:  "https://cdn.example.com/asyncapi",
            }
        });
        // shell.js + shell.css are still local — assets dir is created.
        // Verify that swagger/asyncapi vendored files are skipped, but shell remains.
        const assets = readdirSync(join(outDir, "assets")).sort();
        expect(assets).toEqual(["shell.css", "shell.js"]);

        const html = readFileSync(join(outDir, "index.html"), "utf-8");
        expect(html).toContain("https://cdn.example.com/swagger/swagger-ui-bundle.js");
        expect(html).toContain("https://cdn.example.com/asyncapi/browser/standalone/index.js");
    });

    it("customUi → no assets dir, html is the user's output", async () => {
        await buildApiDocs({
            title: "X", outDir,
            groups: {Users: {http: [UserApi]}},
            customUi: (m) => `<custom>${m.title}</custom>`,
        });
        expect(existsSync(join(outDir, "assets"))).toBe(false);
        const html = readFileSync(join(outDir, "index.html"), "utf-8");
        expect(html).toBe("<custom>X</custom>");
    });

    it("shell html uses ./assets/ relative paths", async () => {
        await buildApiDocs({
            title: "X", outDir,
            groups: {Users: {http: [UserApi]}}
        });
        const html = readFileSync(join(outDir, "index.html"), "utf-8");
        expect(html).toContain('href="./assets/swagger-ui.css"');
        expect(html).toContain('src="./assets/shell.js"');
        // Viewer JS is loaded dynamically by shell.js — URL appears in the
        // GG_API_DOCS_ASSETS bootstrap JSON, not as a static <script src>.
        expect(html).toContain('"swaggerUiJs":"./assets/swagger-ui-bundle.js"');
        expect(html).toContain('"asyncApiJs":"./assets/asyncapi-component.js"');
    });
});
