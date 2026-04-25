import type {ApiDocsManifest} from "../types";

/**
 * Asset URLs the shell needs at render time.
 * For live mode these are absolute server paths; for static mode they're
 * relative ("./assets/...").
 */
export interface ShellAssetUrls {
    swaggerUiCss: string;
    swaggerUiJs: string;
    asyncApiCss: string;
    asyncApiJs: string;
    shellCss: string;
    shellJs: string;
    /** URL to the manifest.json that drives the sidebar. */
    manifestUrl: string;
}

/**
 * Build the shell HTML page.
 *
 * The shell is intentionally small — sidebar + right pane. The embedded
 * viewers (Swagger UI, AsyncAPI react-component) render inside the right
 * pane. The shell.js script wires up navigation between them.
 *
 * The manifest is embedded inline as a JSON `<script>` tag so the page
 * can render the sidebar without an extra fetch.
 */
export function buildShellHtml(manifest: ApiDocsManifest, assets: ShellAssetUrls): string {
    const manifestJson = JSON.stringify(manifest);
    const branding = manifest.branding ?? {};
    const primaryColor = branding.primaryColor ?? "#3b82f6";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(manifest.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="${assets.swaggerUiCss}" />
  <link rel="stylesheet" href="${assets.asyncApiCss}" />
  <link rel="stylesheet" href="${assets.shellCss}" />
  <style>:root { --gg-primary: ${primaryColor}; }</style>
</head>
<body>
<div class="gg-shell">
  <aside class="gg-sidebar" id="gg-sidebar">
    <div class="gg-header">
      ${branding.logoUrl ? `<img class="gg-logo" src="${escapeHtml(branding.logoUrl)}" alt="" />` : ""}
      <div class="gg-title">${escapeHtml(manifest.title)}</div>
      ${manifest.version ? `<div class="gg-version">v${escapeHtml(manifest.version)}</div>` : ""}
    </div>
    <nav class="gg-nav" id="gg-nav"></nav>
  </aside>
  <main class="gg-main">
    <div class="gg-pane" id="gg-pane"></div>
  </main>
</div>
<script type="application/json" id="gg-manifest">${manifestJson}</script>
<script>window.GG_API_DOCS_ASSETS = ${JSON.stringify({swaggerUiJs: assets.swaggerUiJs, asyncApiJs: assets.asyncApiJs})};</script>
<script src="${assets.shellJs}"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!);
}
