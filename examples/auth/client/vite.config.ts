import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"

// Run the auth server with: cd examples/auth/server && PORT=4600 npm start
// Then start this client with: cd examples/auth/client && npm run dev
export default defineConfig({
    plugins: [react()],
    server: {
        port: 3001,
        host: "0.0.0.0",
        allowedHosts: true,
        proxy: {
            "/pub": "http://localhost:4600",
            "/api": "http://localhost:4600",
            "/ws": {
                target: "ws://localhost:4600",
                ws: true,
            },
        },
    },
    // The client imports TypeScript source files from ../../server/common/api/…
    // Those files transitively import all @grest-ts/* packages. Without explicit
    // configuration Vite pre-bundles some of them (from optimizeDeps.include) and
    // loads others raw via @fs/…, triggering grest-ts's duplicate-load guard.
    // Fix: pre-bundle every @grest-ts/* package the app touches AND force
    // resolve.dedupe so all paths in the module graph share one copy.
    resolve: {
        dedupe: [
            "@grest-ts/common",
            "@grest-ts/context",
            "@grest-ts/schema",
            "@grest-ts/http",
            "@grest-ts/websocket",
            "@grest-ts/locator",
        ],
    },
    optimizeDeps: {
        // Also scan the shared server contracts so Vite discovers all transitive deps.
        entries: [
            "index.html",
            "../../server/common/**/*.ts",
        ],
        include: [
            "@grest-ts/common",
            "@grest-ts/context",
            "@grest-ts/schema",
            "@grest-ts/http",
            "@grest-ts/websocket",
            "@grest-ts/locator",
        ],
    },
})
