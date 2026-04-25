import {GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import {GGLocator} from "@grest-ts/locator";
import {toOpenApi} from "@grest-ts/openapi";
import {toAsyncApi} from "@grest-ts/asyncapi";
import type {ApiDocsCommonOptions, ApiDocsManifest} from "./types";
import {buildManifest, findGroupHttpSchemas, findGroupWsSchemas, resolveGroups, toSlug} from "./manifest";
import {buildShellHtml} from "./shell/shellHtml";
import {loadVendoredAssets} from "./shell/assets";

export interface GGApiDocsOptions extends ApiDocsCommonOptions {
    /**
     * Mount path. All sub-routes hang off this prefix —
     *   GET ${docsPath}                              → shell HTML
     *   GET ${docsPath}/manifest.json                → manifest
     *   GET ${docsPath}/specs/<group>/openapi.json   → OpenAPI spec
     *   GET ${docsPath}/specs/<group>/asyncapi.json  → AsyncAPI spec
     *   GET ${docsPath}/assets/<filename>            → bundled viewer assets
     */
    docsPath: string;

    /** Build all specs eagerly at construction (default: lazy on first request). */
    eager?: boolean;

    /**
     * Override the HTTP server to mount routes on. Defaults to the locator's
     * GG_HTTP_SERVER. Named `httpServer` (not `http`) to avoid colliding with
     * the `http` schemas shorthand on the common options.
     */
    httpServer?: GGHttpServer;

    /**
     * Load embedded viewer assets from a CDN instead of serving the bundled
     * copies. When set for a viewer, the corresponding /assets/* route is not
     * registered and the shell loads the script directly from the CDN URL.
     */
    cdnUrl?: {
        swaggerUi?: string;   // e.g. "https://unpkg.com/swagger-ui-dist@5.32.2"
        asyncApi?: string;    // e.g. "https://unpkg.com/@asyncapi/react-component@latest"
    };

    /**
     * Replace the shell HTML entirely. Receives the manifest so the user can
     * build their own switcher UI around the same standards-compliant spec
     * endpoints we serve.
     */
    customUi?: (manifest: ApiDocsManifest) => string;
}

/**
 * Unified HTTP + WebSocket API documentation UI.
 *
 * `GGApiDocs.register({...})` mounts a single shell at `docsPath` whose sidebar
 * lists each group with its HTTP and/or WebSocket APIs. Selecting an entry
 * loads the appropriate spec into the right pane via the matching embedded
 * viewer (Swagger UI for OpenAPI, AsyncAPI react-component for AsyncAPI).
 *
 * Spec JSON is unchanged — it is the same OpenAPI 3.1 / AsyncAPI 3.0 output
 * that `toOpenApi()` / `toAsyncApi()` produce, served at predictable URLs
 * that any external tool can consume.
 *
 * @example
 * GGApiDocs.register({
 *     title: "MyOrg",
 *     docsPath: "/docs",
 *     groups: {
 *         "Users":  { http: [UserApi], ws: [UserNotificationsApi] },
 *         "Orders": { http: [OrderApi] },
 *     },
 * });
 */
export class GGApiDocs {
    private readonly options: GGApiDocsOptions;
    private readonly manifest: ApiDocsManifest;
    private readonly openapiCache = new Map<string, unknown>();
    private readonly asyncapiCache = new Map<string, unknown>();

    static register(options: GGApiDocsOptions): void {
        const server = options.httpServer ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGApiDocs.register: no HTTP server found. Pass options.httpServer or create a GGHttpServer first.");
        new GGApiDocs(server, options);
    }

    constructor(server: GGHttpServer, options: GGApiDocsOptions) {
        this.options = options;
        this.manifest = buildManifest(options, options.docsPath);
        if (options.eager) {
            for (const group of this.manifest.groups) {
                for (const spec of group.specs) {
                    if (spec.type === "openapi") this.openapiCache.set(group.name, this.buildOpenApi(group.name));
                    else this.asyncapiCache.set(group.name, this.buildAsyncApi(group.name));
                }
            }
        }
        this.registerWith(server);
    }

    public getManifest(): ApiDocsManifest {
        return this.manifest;
    }

    public getSpec(groupName: string, type: "openapi" | "asyncapi"): unknown {
        if (type === "openapi") {
            let spec = this.openapiCache.get(groupName);
            if (!spec) { spec = this.buildOpenApi(groupName); this.openapiCache.set(groupName, spec); }
            return spec;
        } else {
            let spec = this.asyncapiCache.get(groupName);
            if (!spec) { spec = this.buildAsyncApi(groupName); this.asyncapiCache.set(groupName, spec); }
            return spec;
        }
    }

    private buildOpenApi(groupName: string): unknown {
        const schemas = findGroupHttpSchemas(this.options, groupName);
        if (!schemas) throw new Error(`GGApiDocs: group "${groupName}" has no HTTP schemas.`);
        return toOpenApi(schemas, this.options);
    }

    private buildAsyncApi(groupName: string): unknown {
        const schemas = findGroupWsSchemas(this.options, groupName);
        if (!schemas) throw new Error(`GGApiDocs: group "${groupName}" has no WebSocket schemas.`);
        return toAsyncApi(schemas, this.options);
    }

    public registerWith(server: GGHttpServer): this {
        const docsPath = this.options.docsPath;

        // Manifest endpoint
        server.registerRoute("GET", `${docsPath}/manifest.json`, async (_req, res) => {
            const body = JSON.stringify(this.manifest, null, 2);
            res.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)});
            res.end(body);
        });

        // Per-group spec endpoints (only register routes for spec types that exist)
        for (const {name, group} of resolveGroups(this.options)) {
            const slug = toSlug(name);
            if (group.http && group.http.length > 0) {
                server.registerRoute("GET", `${docsPath}/specs/${slug}/openapi.json`, async (_req, res) => {
                    const body = JSON.stringify(this.getSpec(name, "openapi"), null, 2);
                    res.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)});
                    res.end(body);
                });
            }
            if (group.ws && group.ws.length > 0) {
                server.registerRoute("GET", `${docsPath}/specs/${slug}/asyncapi.json`, async (_req, res) => {
                    const body = JSON.stringify(this.getSpec(name, "asyncapi"), null, 2);
                    res.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)});
                    res.end(body);
                });
            }
        }

        // Shell HTML route
        server.registerRoute("GET", docsPath, async (_req, res) => {
            const html = this.buildHtml();
            res.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html)});
            res.end(html);
        });

        // Bundled assets — only register what we actually serve.
        if (!this.options.customUi) {
            const assetsBase = `${docsPath}/assets`;
            const assets = loadVendoredAssets();
            const cdn = this.options.cdnUrl ?? {};
            for (const a of assets) {
                if (cdn.swaggerUi && (a.filename === "swagger-ui-bundle.js" || a.filename === "swagger-ui.css")) continue;
                if (cdn.asyncApi && (a.filename === "asyncapi-component.js" || a.filename === "asyncapi-component.css")) continue;
                server.registerRoute("GET", `${assetsBase}/${a.filename}`, async (_req, res) => {
                    res.writeHead(200, {
                        "Content-Type": a.contentType,
                        "Content-Length": a.body.length,
                        "Cache-Control": "public, max-age=86400"
                    });
                    res.end(a.body);
                });
            }
        }

        return this;
    }

    private buildHtml(): string {
        if (this.options.customUi) return this.options.customUi(this.manifest);
        const docsPath = this.options.docsPath;
        const cdn = this.options.cdnUrl ?? {};
        const swagger = cdn.swaggerUi
            ? {js: `${cdn.swaggerUi}/swagger-ui-bundle.js`, css: `${cdn.swaggerUi}/swagger-ui.css`}
            : {js: `${docsPath}/assets/swagger-ui-bundle.js`, css: `${docsPath}/assets/swagger-ui.css`};
        const asyncApi = cdn.asyncApi
            ? {
                js: `${cdn.asyncApi}/browser/standalone/index.js`,
                css: `${cdn.asyncApi}/styles/default.min.css`
            }
            : {js: `${docsPath}/assets/asyncapi-component.js`, css: `${docsPath}/assets/asyncapi-component.css`};
        return buildShellHtml(this.manifest, {
            swaggerUiCss: swagger.css,
            swaggerUiJs: swagger.js,
            asyncApiCss: asyncApi.css,
            asyncApiJs: asyncApi.js,
            shellCss: `${docsPath}/assets/shell.css`,
            shellJs: `${docsPath}/assets/shell.js`,
            manifestUrl: `${docsPath}/manifest.json`,
        });
    }
}
