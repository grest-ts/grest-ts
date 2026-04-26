import {readFileSync} from "fs";
import {dirname, join} from "path";
import {createRequire} from "module";
import type {GGHttpSchema} from "@grest-ts/http";
import {GGHttp, GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import {GGLocator} from "@grest-ts/locator";
import type {OpenAPIV3_1} from "openapi-types";
import {toOpenApi, ToOpenApiOptions} from "./toOpenApi";
import {GGOpenApiDocsGroups, GGOpenApiDocsGroupsOptions} from "./GGOpenApiDocsGroups";

// Resolve swagger-ui-dist via require.resolve so workspace hoisting is handled correctly.
const _require = createRequire(import.meta.url);
const SWAGGER_UI_DIST = dirname(_require.resolve("swagger-ui-dist/swagger-ui-bundle.js"));

function readSwaggerAsset(filename: string): Buffer {
    return readFileSync(join(SWAGGER_UI_DIST, filename));
}

export interface GGOpenApiDocsOptions extends ToOpenApiOptions {
    /**
     * Path where the JSON spec is served.
     * e.g. "/openapi.json" or "/api/spec"
     */
    specPath: string;

    /**
     * Path where the Swagger UI HTML page is served.
     * e.g. "/docs" or "/api/docs"
     */
    docsPath: string;

    /**
     * If true, the OpenAPI spec is built immediately on construction rather
     * than on first request. When false (default), the spec is built lazily
     * on the first GET /openapi.json request, which means it captures every
     * schema that was registered during compose().
     * @default false
     */
    eager?: boolean;

    /**
     * Explicit schema list to generate the spec from.
     * When provided, overrides server.registeredSchemas — useful for schemas
     * that have no registered implementation (e.g. a showcase or documentation server).
     *
     * @example
     * GGOpenApiDocs.register({
     *     http: dedicatedServer,
     *     schemas: [MyApi, OtherApi],
     *     title: "My API", specPath: "/openapi.json", docsPath: "/docs"
     * });
     */
    schemas?: GGHttpSchema<any, any>[];

    /**
     * Serve Swagger UI assets from a CDN instead of the bundled swagger-ui-dist package.
     * Useful for environments where you want minimal payload or already have a CDN.
     *
     * When set, the /docs page loads JS/CSS from this base URL (no trailing slash).
     * @example "https://unpkg.com/swagger-ui-dist@5.32.2"
     */
    cdnUrl?: string;

    /**
     * Completely replace the Swagger UI HTML page with your own.
     * Receives the spec URL and must return a complete HTML string.
     * Use this for custom branding, alternative UIs (Redoc, Scalar, etc.), or
     * environments where serving from node_modules is not possible.
     *
     * @example
     * customUi: (specUrl) => `<!DOCTYPE html>...your HTML using specUrl...`
     */
    customUi?: (specUrl: string) => string;

    /**
     * The HTTP server to register the docs routes on.
     * When omitted, uses the default GGHttpServer from the locator — the same
     * fallback as MyApi.register().
     */
    http?: GGHttpServer;
}

/**
 * Serves GET /openapi.json and GET /docs (Swagger UI) for all schemas
 * registered on a GGHttpServer.
 *
 * Schemas are collected automatically — every schema.register() / GGHttp.http()
 * call during compose() is tracked on the server. The spec is built lazily
 * on first request (or eagerly if { eager: true }) so it always reflects the
 * full set of registered schemas.
 *
 * Swagger UI assets are served from the bundled swagger-ui-dist package —
 * no CDN dependency, works offline and in air-gapped environments.
 *
 * @example
 * // Fluent builder — openApi() reads all .http() schemas automatically:
 * import "@grest-ts/openapi";
 *
 * const server = new GGHttpServer();
 * new GGHttp(server)
 *     .http(MyApiSchema, impl)
 *     .openApi({ title: "My API", version: "1.0.0", specPath: "/openapi.json", docsPath: "/docs" });
 *
 * @example
 * // Standalone — mirrors MyApi.register() exactly:
 * MyApi.register(impl);
 * GGOpenApiDocs.register({ title: "My API", specPath: "/openapi.json", docsPath: "/docs" });
 *
 * @example
 * // With explicit server (same pattern as MyApi.register(impl, {http: server})):
 * GGOpenApiDocs.register({ title: "My API", specPath: "/openapi.json", docsPath: "/docs", http: server });
 */
export class GGOpenApiDocs {
    private readonly server: GGHttpServer;
    private readonly options: GGOpenApiDocsOptions;
    private _spec: OpenAPIV3_1.Document | undefined;

    /**
     * Register OpenAPI docs routes on an HTTP server.
     * Mirrors the MyApi.register() pattern exactly:
     *   - options.http — explicit server (optional)
     *   - when absent, uses the default GGHttpServer from the locator
     */
    static register(options: GGOpenApiDocsOptions): void {
        const server = options.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGOpenApiDocs.register: no HTTP server found. Pass options.http or create a GGHttpServer first.");
        new GGOpenApiDocs(server, options);
    }

    /**
     * Register a multi-spec Swagger UI with one spec per group, switched via
     * Swagger UI's built-in `urls` dropdown. Useful when one service exposes
     * APIs that consumers want to browse separately (per team, per domain, etc.).
     *
     * @example
     * GGOpenApiDocs.registerGroups({
     *     groups: { Users: [UserApi], Orders: [OrderApi] },
     *     specPathPrefix: "/openapi",
     *     docsPath: "/docs",
     * });
     */
    static registerGroups(options: GGOpenApiDocsGroupsOptions): void {
        GGOpenApiDocsGroups.register(options);
    }

    constructor(server: GGHttpServer, options: GGOpenApiDocsOptions) {
        this.server = server;
        this.options = options;
        if (options.eager) {
            this._spec = this.buildSpec();
        }
        this.registerWith(server);
    }

    private buildSpec(): OpenAPIV3_1.Document {
        const schemas = this.options.schemas ?? (this.server.registeredSchemas as GGHttpSchema<any, any>[]);
        return toOpenApi(schemas, this.options);
    }

    public getSpec(): OpenAPIV3_1.Document {
        return this._spec ??= this.buildSpec();
    }

    public registerWith(server: GGHttpServer): this {
        const specPath = this.options.specPath;
        const docsPath = this.options.docsPath;

        server.registerRoute("GET", specPath, async (_req, res) => {
            const spec = this.getSpec();
            const body = JSON.stringify(spec, null, 2);
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            });
            res.end(body);
        });

        server.registerRoute("GET", docsPath, async (_req, res) => {
            const html = this.buildDocsHtml(specPath);
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(html)
            });
            res.end(html);
        });

        // Serve bundled Swagger UI assets (only when not using CDN or custom UI)
        if (!this.options.cdnUrl && !this.options.customUi) {
            const uiBase = docsPath + "/assets";

            const serveAsset = (filename: string, contentType: string) => {
                const asset = readSwaggerAsset(filename);
                server.registerRoute("GET", `${uiBase}/${filename}`, async (_req, res) => {
                    res.writeHead(200, {
                        "Content-Type": contentType,
                        "Content-Length": asset.length,
                        "Cache-Control": "public, max-age=86400"
                    });
                    res.end(asset);
                });
            };

            serveAsset("swagger-ui-bundle.js", "application/javascript");
            serveAsset("swagger-ui.css", "text/css");
        }

        return this;
    }

    private buildDocsHtml(specUrl: string): string {
        if (this.options.customUi) {
            return this.options.customUi(specUrl);
        }
        if (this.options.cdnUrl) {
            return buildCdnHtml(specUrl, this.options.cdnUrl);
        }
        return buildBundledHtml(specUrl, this.options.docsPath + "/assets");
    }
}

function buildBundledHtml(specUrl: string, assetsBase: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${assetsBase}/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="${assetsBase}/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: ${JSON.stringify(specUrl)},
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true
  });
</script>
</body>
</html>`;
}

function buildCdnHtml(specUrl: string, cdnUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${cdnUrl}/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="${cdnUrl}/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: ${JSON.stringify(specUrl)},
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// GGHttp module augmentation — adds .openApi() to the builder chain
// ---------------------------------------------------------------------------

declare module "@grest-ts/http" {
    interface GGHttp<TContext = undefined> {
        /**
         * Register OpenAPI spec endpoint and Swagger UI for all schemas
         * registered on this GGHttp instance via .http().
         *
         * Schemas are collected automatically — no need to list them again.
         * The spec is built lazily on the first request so it captures every
         * schema registered before the server starts.
         *
         * Swagger UI assets are served from the bundled swagger-ui-dist package.
         * Use { cdnUrl: "..." } to load from a CDN, or { customUi: fn } for a
         * completely custom UI.
         *
         * @example
         * new GGHttp(server)
         *   .http(MyApiSchema, impl)
         *   .openApi({ title: "My API", specPath: "/openapi.json", docsPath: "/docs" });
         */
        openApi(options: GGOpenApiDocsOptions): this;
    }
}

GGHttp.prototype.openApi = function (
    this: GGHttp,
    options: GGOpenApiDocsOptions
): typeof this {
    new GGOpenApiDocs(this.httpServer, options); // auto-registers in constructor
    return this;
};

// Keep backward-compatible overload that still accepts an explicit schema list.
// This is useful for toOpenApi() in CI scripts and standalone GGOpenApiDocs usage.
export type {GGHttpSchema};
