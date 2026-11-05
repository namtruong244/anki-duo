import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Anki Duo',
        short_name: 'Anki Duo',
        description: 'Spaced repetition, the fun way.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#ffffff',
        theme_color: '#2e7d00',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,woff2}'] },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // Same-origin in development, like production (research R18).
    proxy: { '/api': 'http://localhost:8787' },
  },
});
