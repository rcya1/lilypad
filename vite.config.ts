import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import svgLoader from 'vite-svg-loader'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Dev-only `POST /api/capture`, so `yarn dev` needs no second server (production: api/capture.ts).
 */
function devCapturePlugin(): Plugin {
  return {
    name: 'lily-dev-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const { url } = JSON.parse(body || '{}')
            const { assertCapturableUrl, captureUrl } = await import('./tools/capture.mjs')
            try {
              await assertCapturableUrl(url)
            } catch (err) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
              return
            }
            const result = await captureUrl(url)
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(result))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
        })
      })
    },
  }
}

/**
 * Installable app + service worker. The app shell is precached; note data lives in IndexedDB
 * (src/lib/offline.ts). Images and captured pages are cached once opened (sign-out deletes them).
 */
function pwaPlugin() {
  return VitePWA({
    registerType: 'prompt',
    includeAssets: ['icons/apple-touch-icon.png'],
    manifest: {
      name: 'Lilypad',
      short_name: 'Lilypad',
      description: 'Markdown notes, annotated web pages and PDFs.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f4f8f4',
      theme_color: '#e5eee5',
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
    workbox: {
      // woff2 only: browsers that can run a service worker all pick KaTeX's woff2 fonts.
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [
        {
          urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'google-fonts-css' },
        },
        {
          urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
          handler: 'CacheFirst',
          options: {
            cacheName: 'google-fonts',
            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Images: public Storage URLs. Immutable — every upload gets a fresh UUID path.
          urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public/'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'lilypad-images',
            expiration: { maxEntries: 1000 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Captured web pages (`<user>/<entry>.html` downloads). Snapshots never change.
          urlPattern: ({ url, request }) =>
            request.method === 'GET' &&
            url.pathname.startsWith('/storage/v1/object/') &&
            url.pathname.endsWith('.html'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'lilypad-pages',
            expiration: { maxEntries: 300 },
            cacheableResponse: { statuses: [200] },
          },
        },
      ],
    },
  })
}

export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss(), svgLoader(), devCapturePlugin(), pwaPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: ['codemirror', '@codemirror/lang-markdown'],
          'codemirror-vim': ['@replit/codemirror-vim'],
          katex: ['katex', 'marked', 'marked-katex-extension'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
