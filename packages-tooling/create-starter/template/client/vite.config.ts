import {defineConfig} from 'vite'
// @ts-ignore
import path from 'path'

export default defineConfig({
    server: {
        port: 3000,
        proxy: {
            '/api': 'http://localhost:9000',
        },
    },
    build: {
        outDir: 'build',
        rollupOptions: {
            external: ['@gg/discovery'],
        },
    },
    resolve: {
        alias: {
            '@newproject/api': path.resolve(__dirname, '../api/src'),
        },
    },
    optimizeDeps: {
        exclude: ['@newproject/api'],
    },
})
