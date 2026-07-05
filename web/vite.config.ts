import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We ship our own public/manifest.webmanifest (mirrors fit/web).
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest,png,ico}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Never cache API responses in the SW — reads are cheap and we want
        // fresh bottles/notes on every load.
        runtimeCaching: [],
      },
    }),
  ],
  // amazon-cognito-identity-js expects Node's `global`.
  define: { global: 'globalThis' },
  server: {
    // Local dev talks to the deployed API through the real CloudFront distro
    // when VITE_USE_MOCK is false; otherwise the in-memory mock handles it.
    proxy: {
      '/api': { target: 'https://dram.zackwithers.com', changeOrigin: true },
    },
  },
})
