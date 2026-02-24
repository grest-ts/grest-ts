/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  optimizeDeps: {
    include: [
      '@grest-ts/common',
      '@grest-ts/http/browser',
      '@grest-ts/logger',
      '@grest-ts/validator'
    ],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  }
})
