// Headless-Chromium page capture — the dev/server side of the Web Annotations feature.
//
// Ported from experiments/web-capture-spike/capture.mjs (Phase 0, validated). Loads a URL,
// inlines external stylesheets (url()/@import rewritten to absolute), injects a <base href> so
// images/fonts still resolve, strips all scripts, and returns a single inert HTML string.
//
// Lives outside src/ so the client bundle never imports Playwright. Consumed by the Vite dev
// middleware (devCapturePlugin in vite.config.ts) and the Vercel serverless function
// (api/capture.ts).

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/** True if a resolved address falls in a loopback/private/link-local/metadata range. */
function isBlockedAddress(address, family) {
  if (family === 4) {
    const octets = address.split('.').map(Number)
    const [a, b] = octets
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata (169.254.169.254)
    return false
  }
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('fe80:')) return true // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // unique local
  if (normalized.startsWith('::ffff:')) {
    return isBlockedAddress(normalized.slice('::ffff:'.length), 4)
  }
  return false
}

/**
 * Rejects capture targets that aren't public http(s) URLs, including ones that resolve (via
 * DNS) to a loopback/private/link-local address — defends the capture endpoint against SSRF,
 * such as reaching cloud metadata services (169.254.169.254) from inside the capture sandbox.
 *
 * @param {string} rawUrl
 * @throws {Error} with a user-facing message if the URL is disallowed
 */
export async function assertCapturableUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('A valid http(s) url is required')
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Only http and https URLs can be captured')
  }
  if (parsed.hostname === 'localhost') {
    throw new Error('Cannot capture local or private network addresses')
  }

  const literalFamily = isIP(parsed.hostname)
  if (literalFamily) {
    if (isBlockedAddress(parsed.hostname, literalFamily)) {
      throw new Error('Cannot capture local or private network addresses')
    }
    return
  }

  const resolved = await lookup(parsed.hostname, { all: true })
  if (resolved.some(({ address, family }) => isBlockedAddress(address, family))) {
    throw new Error('Cannot capture local or private network addresses')
  }
}

/** Rewrite relative url(...) and @import targets in a stylesheet to absolute. */
function absolutizeCss(css, sheetUrl) {
  const abs = (ref) => {
    const v = ref.trim().replace(/^['"]|['"]$/g, '')
    if (/^(data:|https?:|#)/i.test(v)) return v
    try {
      return new URL(v, sheetUrl).href
    } catch {
      return v
    }
  }
  return css
    .replace(/url\(\s*([^)]+?)\s*\)/gi, (_m, ref) => `url("${abs(ref)}")`)
    .replace(/@import\s+(['"])(.*?)\1/gi, (_m, _q, ref) => `@import "${abs(ref)}"`)
}

/**
 * Serialize an already-navigated Playwright page into one inert, self-contained HTML string.
 * Env-agnostic: the caller is responsible for launching/closing the browser, so this works
 * with both `playwright` (dev) and `playwright-core` + `@sparticuz/chromium` (prod).
 *
 * @returns {Promise<{ html: string, title: string, finalUrl: string }>}
 */
export async function serializeSnapshot(page) {
  const finalUrl = page.url()

  const sheetHrefs = await page.$$eval('link[rel~="stylesheet"][href]', (els) =>
    els.map((e) => e.href),
  )
  const inlined = []
  for (const href of sheetHrefs) {
    try {
      const res = await page.request.get(href)
      if (!res.ok()) throw new Error(`HTTP ${res.status()}`)
      inlined.push(absolutizeCss(await res.text(), href))
    } catch {
      // Skip stylesheets we can't fetch; the page still renders with what's left.
    }
  }

  const html = await page.evaluate(
    ({ baseUrl, inlinedCss }) => {
      document.querySelectorAll('script').forEach((s) => s.remove())
      document.querySelectorAll('*').forEach((el) => {
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
        }
      })
      document
        .querySelectorAll('link[rel~="stylesheet"], link[rel="preload"], link[rel="modulepreload"]')
        .forEach((l) => l.remove())

      const base = document.createElement('base')
      base.href = baseUrl
      document.head.prepend(base)

      const style = document.createElement('style')
      style.setAttribute('data-lily-inlined', '')
      style.textContent = inlinedCss.join('\n\n')
      document.head.appendChild(style)

      return '<!DOCTYPE html>\n' + document.documentElement.outerHTML
    },
    { baseUrl: finalUrl, inlinedCss: inlined },
  )

  const title = (await page.title()) || finalUrl
  return { html, title, finalUrl }
}

/**
 * Dev-path capture: launches bundled Playwright Chromium, captures, returns the snapshot.
 * (Prod will use playwright-core + @sparticuz/chromium with the same `serializeSnapshot`.)
 *
 * @param {string} url
 * @returns {Promise<{ html: string, title: string, finalUrl: string }>}
 */
export async function captureUrl(url) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
    return await serializeSnapshot(page)
  } finally {
    await browser.close()
  }
}
