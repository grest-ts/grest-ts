// Generates a static @grest-ts/api-docs site from the grest-test example
// contracts and writes it under src/public/api-docs-demo so VitePress copies
// it straight to the built site at /api-docs-demo/. Used by the api-docs
// package documentation page to embed a live, interactive demo.
//
// Usage: tsx build-api-docs-demo.ts

import {buildApiDocs} from "@grest-ts/api-docs"
import {join, resolve} from "path"
import {ShowcaseApi} from "../examples/grest-test/src/api/OpenApiShowcaseApi"
import {ChatApiSchema, NotificationApiSchema} from "../examples/grest-test/src/api/AsyncApiShowcaseApi"

const OUT_DIR = resolve(import.meta.dirname, "src", "public", "api-docs-demo")

console.log("Building api-docs live demo...")
console.log(`  → ${OUT_DIR}`)

await buildApiDocs({
    outDir: OUT_DIR,
    docs: [{
        slug: "demo",
        title: "grest-ts API Docs — Live Demo",
        version: "1.0.0",
        description: "Live demo of @grest-ts/api-docs rendering mixed HTTP + WebSocket contracts from the grest-test example service.",
        groups: {
            "HTTP":     {http: [ShowcaseApi]},
            "Realtime": {ws:   [ChatApiSchema, NotificationApiSchema]},
        },
    }],
})

console.log("Done.")
