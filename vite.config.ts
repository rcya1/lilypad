import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import svgLoader from 'vite-svg-loader'

/**
 * Dev-only `POST /api/capture` endpoint for the Web Annotations feature. Runs the headless
 * Chromium capture in the Vite dev process so `yarn dev` needs no second server. In production
 * this path is served by a Vercel serverless function instead (see docs/features).
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
            if (!url || !/^https?:\/\//i.test(url)) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'A valid http(s) url is required' }))
              return
            }
            const { captureUrl } = await import('./tools/capture.mjs')
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss(), svgLoader(), devCapturePlugin()],
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
