import {defineConfig} from "vite"
import react from "@vitejs/plugin-react"

// Run the auth server with: cd examples/auth && PORT=4600 npm start
// Then start this client with: cd examples/auth-client && npm run dev
export default defineConfig({
    plugins: [react()],
    server: {
        port: 3001,
        proxy: {
            "/pub": "http://localhost:4600",
            "/api": "http://localhost:4600",
            "/ws": {
                target: "ws://localhost:4600",
                ws: true,
            },
        },
    },
    optimizeDeps: {
        include: ["@grest-ts/context", "@grest-ts/schema"],
    },
})
