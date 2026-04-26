import {readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync} from "fs";
import {join, dirname} from "path";
import {fileURLToPath} from "url";
import type {GGHttpSchema} from "@grest-ts/http";
import type {GGWebSocketSchema} from "@grest-ts/websocket";
import {buildContractDoc, type BuildContractDocOptions} from "./buildContractDoc";
import type {ApiDocsBranding, ApiDocsGroup} from "./GGApiDocs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_UI = join(HERE, "..", "dist-ui");

export interface BuildApiDocsOptions {
    title: string;
    version?: string;
    description?: string;

    groups?: Record<string, ApiDocsGroup>;
    http?: GGHttpSchema<any, any>[];
    ws?: GGWebSocketSchema<any, any, any, any, any>[];

    branding?: ApiDocsBranding;

    /** Output directory. Created if missing; existing files overwritten. */
    outDir: string;
}

/**
 * Static-mode build — writes a complete static documentation site to `outDir`.
 *
 *   ${outDir}/
 *   ├── index.html              ← shell, references ./assets/* relative
 *   ├── api-docs.json           ← contract doc
 *   └── assets/
 *       └── index-[hash].{js,css}
 *
 * The shell uses relative URLs throughout, so the directory drops onto S3 /
 * GitHub Pages / Cloudflare Pages at any path prefix without rewriting.
 */
export async function buildApiDocs(options: BuildApiDocsOptions): Promise<void> {
    const {outDir} = options;
    mkdirSync(outDir, {recursive: true});

    // Build + write the contract doc
    const groups: BuildContractDocOptions["groups"] = {...(options.groups ?? {})};
    if (options.http?.length || options.ws?.length) {
        groups["API"] = {http: options.http, ws: options.ws};
    }
    const doc = buildContractDoc({
        title: options.title,
        version: options.version,
        description: options.description,
        branding: options.branding,
        groups,
    });
    writeFileSync(join(outDir, "api-docs.json"), JSON.stringify(doc, null, 2));

    // Shell HTML
    writeFileSync(join(outDir, "index.html"), buildStaticShellHtml());

    // Assets — copy the Vite build output verbatim
    const srcAssets = join(DIST_UI, "assets");
    const dstAssets = join(outDir, "assets");
    mkdirSync(dstAssets, {recursive: true});
    for (const filename of readdirSync(srcAssets)) {
        copyFileSync(join(srcAssets, filename), join(dstAssets, filename));
    }
}

/**
 * Build the shell HTML for static output — same Vite-built index.html, with
 * the `GG_API_DOCS_CONFIG` injection pointing at a relative `./api-docs.json`.
 * Asset paths in the template are already relative `./assets/...` from Vite,
 * so no rewriting is needed.
 */
function buildStaticShellHtml(): string {
    const template = readFileSync(join(DIST_UI, "index.html"), "utf-8");
    const configScript = `<script>window.GG_API_DOCS_CONFIG = ${JSON.stringify({docUrl: "./api-docs.json"})};</script>`;
    return template.replace("</head>", `${configScript}</head>`);
}
