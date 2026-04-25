import {mkdirSync, writeFileSync} from "fs";
import {join} from "path";
import {toOpenApi} from "@grest-ts/openapi";
import {toAsyncApi} from "@grest-ts/asyncapi";
import type {ApiDocsCommonOptions, ApiDocsManifest} from "./types";
import {buildManifest, findGroupHttpSchemas, findGroupWsSchemas, resolveGroups, toSlug} from "./manifest";
import {buildShellHtml} from "./shell/shellHtml";
import {loadVendoredAssets} from "./shell/assets";

export interface BuildApiDocsOptions extends ApiDocsCommonOptions {
    /**
     * Output directory. Created if missing. Existing files are overwritten;
     * unrelated files are not removed (caller's responsibility).
     */
    outDir: string;

    /**
     * Load embedded viewer assets from a CDN instead of writing them to disk.
     * When set for a viewer, the corresponding files are not copied and the
     * shell HTML references the CDN URL directly.
     */
    cdnUrl?: {
        swaggerUi?: string;   // e.g. "https://unpkg.com/swagger-ui-dist@5.32.2"
        asyncApi?: string;    // e.g. "https://unpkg.com/@asyncapi/react-component@latest"
    };

    /** Replace the shell HTML entirely. Receives the manifest. */
    customUi?: (manifest: ApiDocsManifest) => string;
}

/**
 * Build a complete static documentation site to disk.
 *
 * Output layout (matches the live mode URL layout exactly, with all paths relative):
 *
 *   ${outDir}/
 *   ├── index.html
 *   ├── manifest.json
 *   ├── specs/
 *   │   ├── ${groupSlug}/
 *   │   │   ├── openapi.json   (only if group has http schemas)
 *   │   │   └── asyncapi.json  (only if group has ws schemas)
 *   │   └── ...
 *   └── assets/                (omitted if both viewers come from CDN)
 *       ├── swagger-ui-bundle.js, swagger-ui.css
 *       ├── asyncapi-component.js, asyncapi-component.css
 *       └── shell.js, shell.css
 *
 * Output is pure static and works behind any path prefix because all URLs
 * in the shell HTML are relative.
 *
 * @example
 * await buildApiDocs({
 *     title: "MyOrg",
 *     outDir: "./dist/docs",
 *     groups: { Users: {http: [UserApi]} },
 * });
 */
export async function buildApiDocs(options: BuildApiDocsOptions): Promise<void> {
    const manifest = buildManifest(options, ".");

    mkdirSync(options.outDir, {recursive: true});

    // Manifest
    writeJson(join(options.outDir, "manifest.json"), manifest);

    // Per-group specs
    for (const {name, group} of resolveGroups(options)) {
        const slug = toSlug(name);
        const specDir = join(options.outDir, "specs", slug);
        mkdirSync(specDir, {recursive: true});
        if (group.http && group.http.length > 0) {
            const schemas = findGroupHttpSchemas(options, name)!;
            writeJson(join(specDir, "openapi.json"), toOpenApi(schemas, options));
        }
        if (group.ws && group.ws.length > 0) {
            const schemas = findGroupWsSchemas(options, name)!;
            writeJson(join(specDir, "asyncapi.json"), toAsyncApi(schemas, options));
        }
    }

    // Assets
    const cdn = options.cdnUrl ?? {};
    if (!options.customUi) {
        const assetsDir = join(options.outDir, "assets");
        let needsDir = false;
        const assets = loadVendoredAssets();
        const filesToWrite: typeof assets = [];
        for (const a of assets) {
            if (cdn.swaggerUi && (a.filename === "swagger-ui-bundle.js" || a.filename === "swagger-ui.css")) continue;
            if (cdn.asyncApi && (a.filename === "asyncapi-component.js" || a.filename === "asyncapi-component.css")) continue;
            filesToWrite.push(a);
            needsDir = true;
        }
        if (needsDir) mkdirSync(assetsDir, {recursive: true});
        for (const a of filesToWrite) {
            writeFileSync(join(assetsDir, a.filename), a.body);
        }
    }

    // Shell HTML
    const html = options.customUi
        ? options.customUi(manifest)
        : buildShellHtml(manifest, {
            swaggerUiCss: cdn.swaggerUi ? `${cdn.swaggerUi}/swagger-ui.css` : "./assets/swagger-ui.css",
            swaggerUiJs:  cdn.swaggerUi ? `${cdn.swaggerUi}/swagger-ui-bundle.js` : "./assets/swagger-ui-bundle.js",
            asyncApiCss:  cdn.asyncApi  ? `${cdn.asyncApi}/styles/default.min.css` : "./assets/asyncapi-component.css",
            asyncApiJs:   cdn.asyncApi  ? `${cdn.asyncApi}/browser/standalone/index.js` : "./assets/asyncapi-component.js",
            shellCss: "./assets/shell.css",
            shellJs:  "./assets/shell.js",
            manifestUrl: "./manifest.json",
        });
    writeFileSync(join(options.outDir, "index.html"), html);
}

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value, null, 2));
}
