import {readFileSync, readdirSync, existsSync} from "fs";
import {join, dirname, extname} from "path";
import {fileURLToPath} from "url";
import type {GGHttpSchema} from "@grest-ts/http";
import {GGHttpServer, GG_HTTP_SERVER} from "@grest-ts/http";
import type {GGWebSocketSchema} from "@grest-ts/websocket";
import {GGLocator} from "@grest-ts/locator";
import {GG_DISCOVERY} from "@grest-ts/discovery";
import {buildContractDoc, type BuildContractDocOptions} from "./buildContractDoc";
import type {ApiDocsDocument} from "./docTypes";

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
 * One logical group. `http` and `ws` arrays carry the actual contracts; both
 * are optional so a group can be HTTP-only, WS-only, or mixed.
 */
export interface ApiDocsGroup {
    http?: GGHttpSchema<any, any>[];
    ws?: GGWebSocketSchema<any, any, any, any, any>[];
    description?: string;
}

export interface ApiDocsBranding {
    logoUrl?: string;
    primaryColor?: string;
}

export interface GGApiDocsOptions {
    title: string;
    version?: string;
    description?: string;

    /** When set, sidebar groups + chrome use these. */
    groups?: Record<string, ApiDocsGroup>;
    /** Convenience shorthand for ungrouped APIs — placed under one "API" group. */
    http?: GGHttpSchema<any, any>[];
    ws?: GGWebSocketSchema<any, any, any, any, any>[];

    /** Mount path. All sub-routes hang off this prefix. */
    docsPath: string;

    branding?: ApiDocsBranding;

    /** Build doc eagerly at construction (default: lazy on first request). */
    eager?: boolean;

    /** Override the HTTP server. Defaults to the locator's GG_HTTP_SERVER. */
    httpServer?: GGHttpServer;
}

/**
 * Live-mode docs server. Mounts a single React UI at `docsPath` plus a
 * `docsPath/api-docs.json` endpoint that returns the contract document.
 *
 * Routes:
 *   GET  ${docsPath}                  → shell HTML (Vite-built React app)
 *   GET  ${docsPath}/api-docs.json    → ApiDocsDocument (lazy build, cached)
 *   GET  ${docsPath}/assets/*         → bundled JS/CSS/etc.
 *
 * No openapi.json / asyncapi.json — those live in their own peer packages
 * (`@grest-ts/openapi`, `@grest-ts/asyncapi`) which a user installs separately
 * if they want them. api-docs is intentionally standalone.
 */
export class GGApiDocs {
    private readonly options: GGApiDocsOptions;
    private _doc: ApiDocsDocument | undefined;

    static register(options: GGApiDocsOptions): void {
        const server = options.httpServer ?? GGLocator.getScope().get(GG_HTTP_SERVER);
        if (!server) throw new Error("GGApiDocs.register: no HTTP server found. Pass options.httpServer or create a GGHttpServer first.");
        new GGApiDocs(server, options);
    }

    constructor(server: GGHttpServer, options: GGApiDocsOptions) {
        this.options = options;
        if (options.eager) this._doc = this.build();
        this.registerWith(server);
    }

    public getDoc(): ApiDocsDocument {
        return this._doc ??= this.build();
    }

    private build(): ApiDocsDocument {
        return buildContractDoc(this.toContractDocOptions());
    }

    private toContractDocOptions(): BuildContractDocOptions {
        const {title, version, description, branding} = this.options;
        const groups: BuildContractDocOptions["groups"] = {...(this.options.groups ?? {})};
        // Top-level http/ws shorthand becomes one synthesized "API" group when
        // no explicit groups are passed; otherwise it's an extra group alongside.
        if (this.options.http?.length || this.options.ws?.length) {
            groups["API"] = {http: this.options.http, ws: this.options.ws};
        }
        return {title, version, description, branding, groups};
    }

    public registerWith(server: GGHttpServer): this {
        const {docsPath} = this.options;

        // JSON doc endpoint — lazy build, cached on the instance.
        server.registerRoute("GET", `${docsPath}/api-docs.json`, async (_req, res) => {
            const body = JSON.stringify(this.getDoc(), null, 2);
            res.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body)});
            res.end(body);
        });

        // Shell HTML — Vite-built React app.
        server.registerRoute("GET", docsPath, async (_req, res) => {
            const html = buildShellHtml(docsPath);
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
 * Also injects `window.GG_API_DOCS_CONFIG = {docUrl: "${docsPath}/api-docs.json"}`
 * so the React app fetches the doc in single-doc mode.
 */
function buildShellHtml(docsPath: string): string {
    const template = loadShellTemplate();
    const rewritten = template.replace(/(src|href)="(\.\/|\/)assets\//g, `$1="${docsPath}/assets/`);
    const configScript = `<script>window.GG_API_DOCS_CONFIG = ${JSON.stringify({docUrl: `${docsPath}/api-docs.json`})};</script>`;
    return rewritten.replace("</head>", `${configScript}</head>`);
}
