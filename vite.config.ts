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
      registerType: 'autoUpdate',
      workbox: {
        // Everything the app needs is precached, so a game can be scored with
        // no connection. Only the dictionary lookup needs the network.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // Absolute base: the service worker and manifest are scoped to the site root,
  // which rules out serving the app from a subpath.
  base: '/',
  server: {
    port: 5173,
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
