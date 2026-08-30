import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The manifest is a static file in public/ so it can be reviewed and
      // tested directly rather than generated at build time.
      manifest: false,
      // 'prompt' rather than 'autoUpdate': the new files land either way, but
      // the open page keeps running the old ones until it reloads, so it is
      // better to offer that than to leave someone on stale code unawares.
      registerType: 'prompt',
      workbox: {
        // Everything the app needs is precached, so a game can be scored with
        // no connection. Only the dictionary lookup needs the network.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        // The fallback is for navigations, and Workbox already scopes it to
        // those. Saying so as well means an asset request can never be answered
        // with the page, which is the shape of the bug this is guarding.
        navigateFallbackDenylist: [/^\/assets\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // One shared library, imported the same way by the app, the tests and the
  // Worker, so no type or rule exists in two places.
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  // Absolute base: the service worker and manifest are scoped to the site root,
  // which rules out serving the app from a subpath.
  base: '/',
  build: {
    // The word list is a megabyte on purpose and is loaded on its own, so the
    // default 500 kB warning only ever fires for it. Raised rather than
    // silenced, so a main bundle that grows into it still says so.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    alias: {
      // Only exists when Vite builds with the PWA plugin.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegisterStub.ts', import.meta.url),
      ),
      // Only exists inside the Workers runtime; lets the router be tested.
      'cloudflare:workers': fileURLToPath(
        new URL('./src/test/cloudflareWorkersStub.ts', import.meta.url),
      ),
    },
  },
});
