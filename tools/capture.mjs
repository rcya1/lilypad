// Headless-Chromium page capture: loads a URL, inlines stylesheets in place (url()/@import made
// absolute), keeps shadow DOM as declarative shadow roots, injects a <base href> so images and
// fonts resolve, strips scripts, and returns one inert HTML string. Outside src/ so the client
// bundle never imports Playwright.

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
 * Rejects anything but public http(s) URLs, including hosts that resolve to private or link-local
 * addresses (SSRF, e.g. cloud metadata at 169.254.169.254).
 *
 * @param {string} rawUrl
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

/** Title text used by common anti-bot interstitials (Cloudflare, Akamai, PerimeterX, ...). */
const CHALLENGE_TITLE_PATTERN =
  /^(just a moment|attention required|access denied|are you a robot|please verify you are a human|checking your browser)/i

/**
 * Throws if the page is an anti-bot interstitial (e.g. Cloudflare's "Just a moment..."), which
 * headless capture can't get past.
 *
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').Response | null} response
 */
async function assertNotChallengePage(page, response) {
  if (response?.headers()['cf-mitigated'] === 'challenge') {
    throw new Error('This page is protected by anti-bot verification and could not be captured.')
  }
  const title = (await page.title()).trim()
  if (CHALLENGE_TITLE_PATTERN.test(title)) {
    throw new Error('This page is protected by anti-bot verification and could not be captured.')
  }
}

/**
 * `load` must succeed; the shorter `networkidle` wait after it is best-effort, since many sites
 * (ads, analytics, beacons) never go idle.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} url
 */
export async function navigateForCapture(page, url) {
  const response = await page.goto(url, { waitUntil: 'load', timeout: 60_000 })
  try {
    await page.waitForLoadState('networkidle', { timeout: 5_000 })
  } catch {
    // Network never went idle (ads/analytics/beacons) — capture what's rendered instead.
  }
  await assertNotChallengePage(page, response)
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
 * Serializes an already-navigated page. The caller launches and closes the browser, so this works
 * with `playwright` (dev) and `playwright-core` + `@sparticuz/chromium` (production).
 *
 * @returns {Promise<{ html: string, title: string, finalUrl: string }>}
 */
export async function serializeSnapshot(page) {
  const finalUrl = page.url()

  const sheetHrefs = await page.$$eval('link[rel~="stylesheet"][href]', (els) =>
    els.map((e) => e.href),
  )
  /** href → its CSS, for the stylesheets we could fetch. */
  const inlined = {}
  for (const href of new Set(sheetHrefs)) {
    try {
      const res = await page.request.get(href)
      if (!res.ok()) throw new Error(`HTTP ${res.status()}`)
      // A leading BOM is fine at the start of a file but not inside a <style>, where it makes the
      // first rule invalid (e.g. a site's main @font-face, so the whole page loses its font).
      inlined[href] = absolutizeCss((await res.text()).replace(/^\uFEFF/, ''), href)
    } catch {
      // Left as a <link>; with the <base href> it may still load.
    }
  }

  const html = await page.evaluate(
    ({ baseUrl, inlinedCss }) => {
      // Shadow roots (custom elements like distill's <d-math>) are serialized as declarative
      // shadow DOM, since the scripts that would rebuild them are stripped.
      const roots = [document]
      for (let i = 0; i < roots.length; i++) {
        roots[i].querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) roots.push(el.shadowRoot)
        })
      }

      for (const root of roots) {
        root.querySelectorAll('script').forEach((s) => s.remove())
        root.querySelectorAll('*').forEach((el) => {
          for (const attr of [...el.attributes]) {
            if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
          }
        })
        root.querySelectorAll('link[rel="preload"], link[rel="modulepreload"]').forEach((l) => {
          l.remove()
        })
        // In place, so the cascade order matches the original page.
        root.querySelectorAll('link[rel~="stylesheet"][href]').forEach((link) => {
          const css = inlinedCss[link.href]
          if (css == null) return
          const style = document.createElement('style')
          style.setAttribute('data-lily-inlined', link.href)
          if (link.media) style.media = link.media
          style.textContent = css
          link.replaceWith(style)
        })
        // `font-display: optional` (and `fallback`) give up on a web font that isn't there almost
        // immediately. The original page preloads its fonts; the snapshot loads them cross-origin
        // and late, so they'd lose that race and the page would render in the fallback font.
        root.querySelectorAll('style').forEach((el) => {
          el.textContent = el.textContent.replace(
            /font-display\s*:\s*(?:optional|fallback)/gi,
            'font-display: swap',
          )
        })
      }

      const base = document.createElement('base')
      base.href = baseUrl
      document.head.prepend(base)

      const html = document.documentElement
      const shadowRoots = roots.slice(1)
      const inner =
        typeof html.getHTML === 'function'
          ? html.getHTML({ serializableShadowRoots: true, shadowRoots })
          : html.innerHTML
      const [openTag] = html.cloneNode(false).outerHTML.split('</html>')
      return `<!DOCTYPE html>\n${openTag}${inner}</html>`
    },
    { baseUrl: finalUrl, inlinedCss: inlined },
  )

  const title = (await page.title()) || finalUrl
  return { html, title, finalUrl }
}

/**
 * Dev capture with Playwright's bundled Chromium.
 *
 * @param {string} url
 * @returns {Promise<{ html: string, title: string, finalUrl: string }>}
 */
export async function captureUrl(url) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await navigateForCapture(page, url)
    return await serializeSnapshot(page)
  } finally {
    await browser.close()
  }
}
