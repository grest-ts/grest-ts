import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App";
import type {ApiDocsConfig} from "./docTypes";
import "./styles.css";

/**
 * Build `window.GG_API_DOCS_CONFIG` from the fixture index, then mount App.
 * The fixtures dir at `/fixtures/<slug>.json` is the same shape any
 * GGApiDocs server would serve at `/<slug>/api-docs.json` — so we point
 * the multi-doc UI at those URLs and the dropdown works exactly the same
 * way it does in production.
 */
async function bootstrap() {
    const res = await fetch("/fixtures/index.json");
    const entries = await res.json() as Array<{slug: string; title: string}>;
    const config: ApiDocsConfig = {
        docs: entries.map(e => ({
            slug: e.slug,
            title: e.title,
            url: `/fixtures/${e.slug}.json`,
        })),
    };
    (window as any).GG_API_DOCS_CONFIG = config;

    const root = document.getElementById("root")!;
    createRoot(root).render(
        <StrictMode>
            <App />
        </StrictMode>
    );
}

bootstrap();
