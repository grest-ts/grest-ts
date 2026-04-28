import {readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync, existsSync} from "fs";
import {join, dirname} from "path";
import {fileURLToPath} from "url";
import {buildContractDoc} from "./buildContractDoc";
import {specToContractOptions, validateDocSpecs, type ApiDocSpec, type ApiDocsBranding} from "./GGApiDocs";
import type {ApiDocsConfig} from "./docTypes";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_UI = existsSync(join(HERE, "..", "dist-ui"))
    ? join(HERE, "..", "dist-ui")           // src/buildApiDocs.{ts,js}
    : join(HERE, "..", "..", "dist-ui");    // dist/src/buildApiDocs.js

export interface BuildApiDocsOptions {
    /** Output directory. Created if missing; existing files overwritten. */
    outDir: string;

    /** Documents to expose. Order = dropdown order; first entry is the default. */
    docs: ApiDocSpec[];

    /** Optional branding applied to every doc. */
    branding?: ApiDocsBranding;
}

/**
 * Static-mode build — writes a complete static documentation site to `outDir`.
 *
 *   ${outDir}/
 *   ├── index.html              ← shell, references ./assets/* relative
 *   ├── <slug-1>/api-docs.json  ← contract doc for first doc
 *   ├── <slug-2>/api-docs.json  ← contract doc for second doc
 *   └── assets/
 *       └── index-[hash].{js,css}
 *
 * The shell uses relative URLs throughout, so the directory drops onto S3 /
 * GitHub Pages / Cloudflare Pages at any path prefix without rewriting.
 */
export async function buildApiDocs(options: BuildApiDocsOptions): Promise<void> {
    const {outDir, docs, branding} = options;
    validateDocSpecs(docs, "buildApiDocs");

    mkdirSync(outDir, {recursive: true});

    // Per-doc directories with api-docs.json
    for (const spec of docs) {
        const docDir = join(outDir, spec.slug);
        mkdirSync(docDir, {recursive: true});
        const doc = buildContractDoc(specToContractOptions(spec, branding));
        writeFileSync(join(docDir, "api-docs.json"), JSON.stringify(doc, null, 2));
    }

    // Shell HTML (relative URLs to per-doc JSONs).
    writeFileSync(join(outDir, "index.html"), buildStaticShellHtml(docs));

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
 * `GG_API_DOCS_CONFIG` injected pointing at relative `./<slug>/api-docs.json`
 * URLs. Asset paths in the template are already relative `./assets/...` from
 * Vite, so no rewriting is needed.
 */
function buildStaticShellHtml(docs: readonly ApiDocSpec[]): string {
    const template = readFileSync(join(DIST_UI, "index.html"), "utf-8");
    const config: ApiDocsConfig = {
        docs: docs.map(d => ({
            slug: d.slug,
            title: d.title,
            url: `./${d.slug}/api-docs.json`,
        })),
    };
    const configScript = `<script>window.GG_API_DOCS_CONFIG = ${JSON.stringify(config)};</script>`;
    return template.replace("</head>", `${configScript}</head>`);
}
