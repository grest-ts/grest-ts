import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * `base: "./"` — emit relative asset paths in the built index.html, so the
 * same dist output works both:
 *   - when served from any URL prefix by GGApiDocs (it rewrites `./assets/`
 *     to the absolute mount path before serving)
 *   - when dropped onto S3 / GitHub Pages via buildApiDocs (no rewriting)
 *
 * `outDir: "../dist-ui"` — the package's distributable UI assets directory,
 * read at runtime by GGApiDocs/buildApiDocs and shipped via npm.
 */
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: "./",
    build: {
        outDir: "../dist-ui",
        emptyOutDir: true,
    },
    server: {port: 5180, host: "127.0.0.1"},
});
