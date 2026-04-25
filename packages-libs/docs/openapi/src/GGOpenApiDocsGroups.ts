import {readFileSync} from "fs";
import {dirname, join} from "path";
import {createRequire} from "module";
import type {GGHttpSchema} from "@grest-ts/http";
import {GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import {GGLocator} from "@grest-ts/locator";
import type {OpenAPIV3_1} from "openapi-types";
import {toOpenApi, ToOpenApiOptions} from "./toOpenApi";

const _require = createRequire(import.meta.url);
const SWAGGER_UI_DIST = dirname(_require.resolve("swagger-ui-dist/swagger-ui-bundle.js"));

function readSwaggerAsset(filename: string): Buffer {
    return readFileSync(join(SWAGGER_UI_DIST, filename));
}

/** Configuration passed to `customUi` so the user can build their own switcher. */
export interface SwaggerUiSwitcherConfig {
    title: string;
    /** Each entry is one spec dropdown choice, in declaration order. */
    urls: Array<{name: string; url: string}>;
    /** Which `name` opens by default. */
    primaryName: string;
}

export interface GGOpenApiDocsGroupsOptions extends ToOpenApiOptions {
    /**
     * Map of group label → schemas in that group. Each group becomes its own
     * OpenAPI spec, served at `${specPathPrefix}/${slug}.json` (kebab-case slug).
     */
    groups: Record<string, GGHttpSchema<any, any>[]>;

    /**
     * Path prefix for spec endpoints. e.g. `/openapi` →
     * `/openapi/users.json`, `/openapi/orders.json`, …
     */
    specPathPrefix: string;

    /**
     * Path where Swagger UI is served. The page contains a dropdown that
     * switches between the group specs.
     */
    docsPath: string;

    /**
     * Which group opens by default. Must be a key of `groups`.
     * Defaults to the first key in declaration order.
     */
    primary?: string;

    /**
     * Also serve a combined spec containing every group's schemas at
     * `${specPathPrefix}/all.json`, and add it as the first dropdown entry.
     */
    combined?: boolean;

    /** Build all specs eagerly at construction (default: lazy on first request). */
    eager?: boolean;

    /** Load Swagger UI from a CDN instead of bundled assets. */
    cdnUrl?: string;

    /** Replace the Swagger UI HTML entirely. Receives the switcher config. */
    customUi?: (config: SwaggerUiSwitcherConfig) => string;

    /** Override the HTTP server. Defaults to the locator's GG_HTTP_SERVER. */
    http?: GGHttpServer;
}

/**
 * Multi-spec Swagger UI — one spec per logical group, switched via the
 * built-in `urls`/`urls.primaryName` Swagger UI configuration.
 *
 * Use this when a single service exposes APIs that consumers would naturally
 * want to browse separately (e.g. by team or domain), without writing a
 * switcher HTML page yourself.
 *
 * @example
 * GGOpenApiDocs.registerGroups({
 *     groups: {
 *         "Users":  [UserApi, ProfileApi],
 *         "Orders": [OrderApi, CartApi],
 *     },
 *     title: "MyOrg",
 *     specPathPrefix: "/openapi",   // /openapi/users.json, /openapi/orders.json
 *     docsPath: "/docs",
 *     primary: "Users",
 * });
 */
export class GGOpenApiDocsGroups {
    private readonly options: GGOpenApiDocsGroupsOptions;
    private readonly groupKeys: string[];
    private readonly slugByGroup: Map<string, string>;
    private readonly specCache = new Map<string, OpenAPIV3_1.Document>();

    static register(options: GGOpenApiDocsGroupsOptions): void {
        const server = options.http ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGOpenApiDocsGroups.register: no HTTP server found. Pass options.http or create a GGHttpServer first.");
        new GGOpenApiDocsGroups(server, options);
    }

    constructor(server: GGHttpServer, options: GGOpenApiDocsGroupsOptions) {
        this.options = options;
        this.groupKeys = Object.keys(options.groups);
        if (this.groupKeys.length === 0) {
            throw new Error("GGOpenApiDocsGroups: `groups` must contain at least one entry.");
        }
        this.slugByGroup = buildSlugMap(this.groupKeys);
        if (options.primary !== undefined && !this.groupKeys.includes(options.primary)) {
            throw new Error(`GGOpenApiDocsGroups: \`primary\` must be a key of \`groups\` (got ${options.primary}).`);
        }
        if (options.eager) {
            for (const name of this.groupKeys) this.specCache.set(name, this.buildSpec(name));
            if (options.combined) this.specCache.set(COMBINED_KEY, this.buildSpec(COMBINED_KEY));
        }
        this.registerWith(server);
    }

    private buildSpec(group: string): OpenAPIV3_1.Document {
        if (group === COMBINED_KEY) {
            const all: GGHttpSchema<any, any>[] = [];
            for (const name of this.groupKeys) all.push(...this.options.groups[name]);
            return toOpenApi(all, this.options);
        }
        const schemas = this.options.groups[group];
        if (!schemas) throw new Error(`GGOpenApiDocsGroups: unknown group ${group}`);
        return toOpenApi(schemas, this.options);
    }

    public getSpec(group: string): OpenAPIV3_1.Document {
        let spec = this.specCache.get(group);
        if (!spec) {
            spec = this.buildSpec(group);
            this.specCache.set(group, spec);
        }
        return spec;
    }

    public buildSwitcherConfig(): SwaggerUiSwitcherConfig {
        const prefix = normalizePathPrefix(this.options.specPathPrefix);
        const urls: SwaggerUiSwitcherConfig["urls"] = [];
        if (this.options.combined) {
            urls.push({name: "All APIs", url: `${prefix}/all.json`});
        }
        for (const name of this.groupKeys) {
            urls.push({name, url: `${prefix}/${this.slugByGroup.get(name)!}.json`});
        }
        const primaryName = this.options.primary
            ?? (this.options.combined ? "All APIs" : this.groupKeys[0]);
        return {
            title: this.options.title ?? "API",
            urls,
            primaryName
        };
    }

    public registerWith(server: GGHttpServer): this {
        const prefix = normalizePathPrefix(this.options.specPathPrefix);

        // Per-group spec routes
        for (const name of this.groupKeys) {
            const slug = this.slugByGroup.get(name)!;
            server.registerRoute("GET", `${prefix}/${slug}.json`, async (_req, res) => {
                const spec = this.getSpec(name);
                const body = JSON.stringify(spec, null, 2);
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                });
                res.end(body);
            });
        }

        // Combined route
        if (this.options.combined) {
            server.registerRoute("GET", `${prefix}/all.json`, async (_req, res) => {
                const spec = this.getSpec(COMBINED_KEY);
                const body = JSON.stringify(spec, null, 2);
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                });
                res.end(body);
            });
        }

        // Docs HTML
        const docsPath = this.options.docsPath;
        server.registerRoute("GET", docsPath, async (_req, res) => {
            const html = this.buildDocsHtml();
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(html)
            });
            res.end(html);
        });

        // Bundled Swagger UI assets (only if not using CDN/customUi)
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

    private buildDocsHtml(): string {
        const config = this.buildSwitcherConfig();
        if (this.options.customUi) return this.options.customUi(config);
        const assetsBase = this.options.cdnUrl ?? this.options.docsPath + "/assets";
        return buildSwitcherHtml(config, assetsBase);
    }
}

const COMBINED_KEY = "__all__";

function normalizePathPrefix(prefix: string): string {
    let p = prefix.trim();
    if (!p.startsWith("/")) p = "/" + p;
    return p.replace(/\/+$/, "");
}

function toSlug(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "group";
}

function buildSlugMap(keys: string[]): Map<string, string> {
    const slugs = new Map<string, string>();
    const used = new Set<string>();
    for (const key of keys) {
        const slug = toSlug(key);
        if (used.has(slug)) {
            throw new Error(`GGOpenApiDocsGroups: group names produce duplicate slug "${slug}". Rename one of: ${keys.filter(k => toSlug(k) === slug).join(", ")}`);
        }
        used.add(slug);
        slugs.set(key, slug);
    }
    return slugs;
}

function buildSwitcherHtml(config: SwaggerUiSwitcherConfig, assetsBase: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(config.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${assetsBase}/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="${assetsBase}/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    urls: ${JSON.stringify(config.urls)},
    "urls.primaryName": ${JSON.stringify(config.primaryName)},
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true
  });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!);
}

export {toSlug as _toSlugForTest};
