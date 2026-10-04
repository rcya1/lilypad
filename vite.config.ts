import { fileURLToPath, URL } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
 * Dev-only `POST /api/fetch-pdf` (production: api/fetch-pdf.ts): fetches a PDF from a URL into a
 * signed Storage upload URL.
 */
function devFetchPdfPlugin(): Plugin {
  return {
    name: 'lily-dev-fetch-pdf',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/fetch-pdf', (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method Not Allowed' }))
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          const { fetchPdfToStorage, FetchPdfError } = await import('./tools/fetch-pdf.mjs')
          try {
            const { url, uploadUrl } = JSON.parse(body || '{}')
            const result = await fetchPdfToStorage({
              url,
              uploadUrl,
              supabaseUrl: server.config.env.VITE_SUPABASE_URL,
              anonKey: server.config.env.VITE_SUPABASE_ANON_KEY,
            })
            res.end(JSON.stringify(result))
          } catch (err) {
            res.statusCode = err instanceof FetchPdfError ? err.status : 500
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
          }
        })
      })
    },
  }
}

/** pdf.js data it fetches at runtime (CJK cMaps, standard fonts, image decoders), under /pdfjs/. */
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
const PDFJS_ROOT = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))

function pdfjsAssetsPlugin(): Plugin {
  return {
    name: 'lily-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]!).replace(/^\/+/, '')
        if (rel.includes('..') || !PDFJS_ASSET_DIRS.includes(rel.split('/')[0]!)) return next()
        try {
          const data = readFileSync(join(PDFJS_ROOT, rel))
          if (rel.endsWith('.wasm')) res.setHeader('content-type', 'application/wasm')
          res.end(data)
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        for (const name of readdirSync(join(PDFJS_ROOT, dir))) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${name}`,
            source: readFileSync(join(PDFJS_ROOT, dir, name)),
          })
        }
      }
    },
  }
}

/**
 * Installable app + service worker. The app shell is precached; note data lives in IndexedDB
 * (src/lib/offline.ts). Images, captured pages and PDFs are cached once opened (sign-out deletes
 * them).
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
      // Lets the app hide the title bar and draw into it (users toggle it from the title bar).
      display_override: ['window-controls-overlay'],
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
      // pdf.js data and decoder fallbacks are fetched on demand (runtime-cached below).
      globIgnores: ['pdfjs/**'],
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
        {
          // PDFs (`<user>/<entry>.pdf` downloads). Never modified, like snapshots.
          urlPattern: ({ url, request }) =>
            request.method === 'GET' &&
            url.pathname.startsWith('/storage/v1/object/') &&
            url.pathname.endsWith('.pdf'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'lilypad-pdfs',
            expiration: { maxEntries: 100 },
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          // pdf.js's worker (an .mjs, so not precached) and its cMaps/fonts, fetched on demand.
          urlPattern: ({ url }) =>
            url.pathname.startsWith('/pdfjs/') || url.pathname.startsWith('/assets/pdf.worker'),
          handler: 'CacheFirst',
          options: { cacheName: 'pdfjs-assets', expiration: { maxEntries: 200 } },
        },
      ],
    },
  })
}

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    svgLoader(),
    devCapturePlugin(),
    devFetchPdfPlugin(),
    pdfjsAssetsPlugin(),
    pwaPlugin(),
  ],
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
