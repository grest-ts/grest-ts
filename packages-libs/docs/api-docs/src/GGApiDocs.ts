import {readFileSync, readdirSync, existsSync} from "fs";
import {join, dirname, extname} from "path";
import {fileURLToPath} from "url";
import type {GGHttpSchema} from "@grest-ts/http";
import {GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import type {GGWebSocketSchema, GGRawWebSocketSchema} from "@grest-ts/websocket";
import {GGLocator} from "@grest-ts/locator";
import {GG_DISCOVERY} from "@grest-ts/discovery";
import {buildContractDoc, type BuildContractDocOptions} from "./buildContractDoc";
import type {ApiDocsConfig, ApiDocsDocument} from "./docTypes";

/**
 * Directory shipped with the package containing the Vite-built React UI.
 * Resolves to <pkg>/dist-ui regardless of whether this module is loaded
 * from src/ (in-tree dev) or dist/src/ (published tarball).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_UI = existsSync(join(HERE, "..", "dist-ui"))
    ? join(HERE, "..", "dist-ui")           // src/GGApiDocs.{ts,js}
    : join(HERE, "..", "..", "dist-ui");    // dist/src/GGApiDocs.js

/**
 * One logical group inside a doc. `http` and `ws` arrays carry the actual
 * contracts; both are optional so a group can be HTTP-only, WS-only, or mixed.
 */
export interface ApiDocsGroup {
    http?: GGHttpSchema<any>[];
    ws?: (GGWebSocketSchema<any> | GGRawWebSocketSchema<any>)[];
    description?: string;
}

export interface ApiDocsBranding {
    logoUrl?: string;
    primaryColor?: string;
}

/**
 * One documented API. The UI dropdown lists these by `title`. Each spec
 * builds an independent `ApiDocsDocument` — schemas/errors are not shared
 * across docs.
 */
export interface ApiDocSpec {
    /** URL slug — must be unique within `docs[]`; used in route `/<docsPath>/<slug>/api-docs.json` and in hash deep-links. */
    slug: string;
    /** Human-readable title shown in the dropdown and as the doc heading. */
    title: string;
    version?: string;
    description?: string;

    /** Group label → schemas. Renders as sidebar sections. */
    groups?: Record<string, ApiDocsGroup>;
    /** Shorthand: ungrouped HTTP schemas — placed under one "API" group. */
    http?: GGHttpSchema<any>[];
    /** Shorthand: ungrouped WebSocket schemas. */
    ws?: (GGWebSocketSchema<any> | GGRawWebSocketSchema<any>)[];
}

export interface GGApiDocsOptions {
    /** Mount path. All sub-routes hang off this prefix. */
    docsPath: string;

    /** Documents to expose. Order = dropdown order; first entry is the default. */
    docs: ApiDocSpec[];

    /** Optional branding applied to every doc. */
    branding?: ApiDocsBranding;

    /** Build all docs eagerly at construction (default: lazy on first request). */
    eager?: boolean;

    /** Override the HTTP server. Defaults to the locator's GG_HTTP_SERVER. */
    httpServer?: GGHttpServer;
}

/**
 * Live-mode docs server. Mounts a single React UI at `docsPath` plus one
 * `api-docs.json` endpoint per doc; the UI fetches the active doc on
 * demand and switches via a dropdown in the header.
 *
 * Routes:
 *   GET  ${docsPath}                            → shell HTML (Vite-built React app)
 *   GET  ${docsPath}/<slug>/api-docs.json       → ApiDocsDocument for that slug (lazy build, cached)
 *   GET  ${docsPath}/assets/*                   → bundled JS/CSS/etc.
 *
 * No openapi.json / asyncapi.json — those live in their own peer packages
 * (`@grest-ts/openapi`, `@grest-ts/asyncapi`) which a user installs separately
 * if they want them. api-docs is intentionally standalone.
 */
export class GGApiDocs {
    private readonly options: GGApiDocsOptions;
    private readonly docCache = new Map<string, ApiDocsDocument>();

    static register(options: GGApiDocsOptions): void {
        const server = options.httpServer ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGApiDocs.register: no HTTP server found. Pass options.httpServer or create a GGHttpServer first.");
        new GGApiDocs(server, options);
    }

    constructor(server: GGHttpServer, options: GGApiDocsOptions) {
        validateDocSpecs(options.docs, "GGApiDocs");
        this.options = options;
        if (options.eager) {
            for (const spec of options.docs) this.getDoc(spec.slug);
        }
        this.registerWith(server);
    }

    /** Build (or return cached) the `ApiDocsDocument` for a given slug. */
    public getDoc(slug: string): ApiDocsDocument {
        const cached = this.docCache.get(slug);
        if (cached) return cached;
        const spec = this.options.docs.find(d => d.slug === slug);
        if (!spec) throw new Error(`GGApiDocs: no such doc slug "${slug}".`);
        const doc = buildContractDoc(specToContractOptions(spec, this.options.branding));
        this.docCache.set(slug, doc);
        return doc;
    }

    public registerWith(server: GGHttpServer): this {
        const {docsPath, docs} = this.options;

        // Per-doc JSON endpoints — lazy build, cached on the instance.
        for (const spec of docs) {
            const url = `${docsPath}/${spec.slug}/api-docs.json`;
            server.registerRoute("GET", url, async (_req, res) => {
                const body = JSON.stringify(this.getDoc(spec.slug), null, 2);
                res.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)});
                res.end(body);
            });
        }

        // Shell HTML — Vite-built React app, with the multi-doc config injected.
        server.registerRoute("GET", docsPath, async (_req, res) => {
            const html = buildShellHtml(docsPath, docs);
            res.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html)});
            res.end(html);
        });

        // Bundled UI assets.
        const assets = loadDistUiAssets();
        const assetsBase = `${docsPath}/assets`;
        for (const [filename, asset] of assets) {
            server.registerRoute("GET", `${assetsBase}/${filename}`, async (_req, res) => {
                res.writeHead(200, {
                    "Content-Type": asset.contentType,
                    "Content-Length": asset.body.length,
                    "Cache-Control": "public, max-age=86400"
                });
                res.end(asset.body);
            });
        }

        // Tell service-discovery (e.g. the local dev router) that requests
        // beginning with `docsPath` belong on this server. Without this, a
        // local-router consumer 404s `/docs` because GGHttpSchema.startServer
        // is the only thing that normally publishes prefixes to discovery.
        // pathPrefix is left without a trailing slash so both `/docs` and
        // `/docs/...` match (the matcher uses `path.startsWith`).
        const docsPrefix = docsPath.endsWith("/") ? docsPath.slice(0, -1) : docsPath;
        const scope = GGLocator.getScope();
        server.onStart(() => {
            GG_DISCOVERY.tryGet()?.registerRoutes([{
                runtime: scope.serviceName,
                api: "GGApiDocs",
                pathPrefix: docsPrefix,
                protocol: "http",
                port: server.port!,
            }]);
        });

        return this;
    }
}

// ── Shared helpers ─────────────────────────────────────────────────────

export function validateDocSpecs(docs: readonly ApiDocSpec[], caller: string): void {
    if (docs.length === 0) {
        throw new Error(`${caller}: options.docs must contain at least one document.`);
    }
    const slugs = new Set<string>();
    for (const spec of docs) {
        if (!spec.slug) throw new Error(`${caller}: every doc must have a non-empty slug.`);
        if (slugs.has(spec.slug)) {
            throw new Error(`${caller}: duplicate slug "${spec.slug}" in options.docs — slugs must be unique.`);
        }
        slugs.add(spec.slug);
    }
}

export function specToContractOptions(spec: ApiDocSpec, branding: ApiDocsBranding | undefined): BuildContractDocOptions {
    const groups: BuildContractDocOptions["groups"] = {...(spec.groups ?? {})};
    if (spec.http?.length || spec.ws?.length) {
        groups["API"] = {http: spec.http, ws: spec.ws};
    }
    return {
        title: spec.title,
        ...(spec.version ? {version: spec.version} : {}),
        ...(spec.description ? {description: spec.description} : {}),
        ...(branding ? {branding} : {}),
        groups,
    };
}

// ── Asset loading from the shipped dist-ui ─────────────────────────────

interface VendoredAsset {
    body: Buffer;
    contentType: string;
}

let _assetCache: Map<string, VendoredAsset> | undefined;
function loadDistUiAssets(): Map<string, VendoredAsset> {
    if (_assetCache) return _assetCache;
    const out = new Map<string, VendoredAsset>();
    const assetsDir = join(DIST_UI, "assets");
    for (const filename of readdirSync(assetsDir)) {
        out.set(filename, {
            body: readFileSync(join(assetsDir, filename)),
            contentType: contentTypeFor(filename),
        });
    }
    _assetCache = out;
    return out;
}

function contentTypeFor(filename: string): string {
    switch (extname(filename).toLowerCase()) {
        case ".js":   return "application/javascript";
        case ".css":  return "text/css";
        case ".html": return "text/html; charset=utf-8";
        case ".svg":  return "image/svg+xml";
        case ".png":  return "image/png";
        case ".woff2": return "font/woff2";
        default:      return "application/octet-stream";
    }
}

// ── Shell HTML — derived from the Vite-built index.html with a few rewrites ──

let _shellTemplate: string | undefined;
function loadShellTemplate(): string {
    if (_shellTemplate) return _shellTemplate;
    _shellTemplate = readFileSync(join(DIST_UI, "index.html"), "utf-8");
    return _shellTemplate;
}

/**
 * Adapt the Vite-built index.html for the runtime mount path. Vite is
 * configured with `base: "./"` so its index.html uses relative `./assets/...`
 * paths — perfect for static mode but ambiguous when served from an arbitrary
 * mount path (browser resolves `./` against the document URL's parent dir,
 * which usually isn't where the assets live). We rewrite to absolute
 * `${docsPath}/assets/...` so requests land on the right place.
 *
 * Also injects the multi-doc `window.GG_API_DOCS_CONFIG` so the React app
 * knows which doc URLs to fetch and what to put in the dropdown.
 */
function buildShellHtml(docsPath: string, docs: readonly ApiDocSpec[]): string {
    const template = loadShellTemplate();
    const rewritten = template.replace(/(src|href)="(\.\/|\/)assets\//g, `$1="${docsPath}/assets/`);
    const config: ApiDocsConfig = {
        docs: docs.map(d => ({
            slug: d.slug,
            title: d.title,
            url: `${docsPath}/${d.slug}/api-docs.json`,
        })),
    };
    const configScript = `<script>window.GG_API_DOCS_CONFIG = ${JSON.stringify(config)};</script>`;
    return rewritten.replace("</head>", `${configScript}</head>`);
}
