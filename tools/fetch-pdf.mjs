// Fetches a PDF from a user-supplied URL and uploads it straight to Supabase Storage through a
// signed upload URL, so the bytes never pass back through the response (Vercel caps those at
// 4.5 MB). Shared by the Vite dev middleware and the Vercel function (api/fetch-pdf.ts).

import { assertCapturableUrl } from './capture.mjs'

export const MAX_PDF_BYTES = 50 * 1024 * 1024
const FETCH_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5
/** The PDF header may follow some junk bytes; readers accept it anywhere in the first 1 KB. */
const HEADER_WINDOW = 1024
const SIGNED_UPLOAD_PREFIX = '/storage/v1/object/upload/sign/user-files/'

export class FetchPdfError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * Only our own bucket's signed upload URLs, or this endpoint could PUT arbitrary bytes anywhere.
 *
 * @param {string} uploadUrl
 * @param {string} supabaseUrl
 */
function assertUploadUrl(uploadUrl, supabaseUrl) {
  let parsed
  try {
    parsed = new URL(uploadUrl)
  } catch {
    throw new FetchPdfError('Invalid upload URL', 400)
  }
  if (
    parsed.origin !== new URL(supabaseUrl).origin ||
    !parsed.pathname.startsWith(SIGNED_UPLOAD_PREFIX) ||
    !parsed.pathname.endsWith('.pdf') ||
    !parsed.searchParams.get('token')
  ) {
    throw new FetchPdfError('Invalid upload URL', 400)
  }
}

/**
 * Follows redirects by hand so every hop goes through the SSRF check.
 *
 * @param {string} url
 * @param {AbortSignal} signal
 */
async function fetchFollowingRedirects(url, signal) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertCapturableUrl(current)
    } catch (err) {
      throw new FetchPdfError(err instanceof Error ? err.message : String(err), 400)
    }
    const res = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: {
        accept: 'application/pdf,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; Lilypad PDF import)',
      },
    })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel()
      current = new URL(location, current).toString()
      continue
    }
    return { res, finalUrl: current }
  }
  throw new FetchPdfError('Too many redirects', 400)
}

/** @param {Uint8Array} bytes */
function hasPdfHeader(bytes) {
  const window = new TextDecoder('latin1').decode(bytes.subarray(0, HEADER_WINDOW))
  return window.includes('%PDF-')
}

/** `filename` from Content-Disposition, else the URL's last path segment. */
function filenameFor(res, finalUrl) {
  const disposition = res.headers.get('content-disposition') ?? ''
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  let name = star?.[1] ?? plain?.[1] ?? ''
  try {
    name = decodeURIComponent(name.trim())
  } catch {
    name = name.trim()
  }
  if (!name) {
    const last = new URL(finalUrl).pathname.split('/').filter(Boolean).pop() ?? ''
    try {
      name = decodeURIComponent(last)
    } catch {
      name = last
    }
  }
  return name || null
}

/**
 * @param {{ url: unknown, uploadUrl: unknown, supabaseUrl: string, anonKey?: string }} input
 * @returns {Promise<{ notPdf: true } | { notPdf: false, finalUrl: string, size: number,
 *   filename: string | null }>}
 */
export async function fetchPdfToStorage({ url, uploadUrl, supabaseUrl, anonKey }) {
  if (typeof url !== 'string' || typeof uploadUrl !== 'string') {
    throw new FetchPdfError('A url and an uploadUrl are required', 400)
  }
  assertUploadUrl(uploadUrl, supabaseUrl)

  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const { res, finalUrl } = await fetchFollowingRedirects(url, signal)
  if (!res.ok || !res.body) {
    await res.body?.cancel()
    throw new FetchPdfError(`The server responded with ${res.status}`, 502)
  }

  const declared = Number(res.headers.get('content-length') ?? '')
  if (declared > MAX_PDF_BYTES) {
    await res.body.cancel()
    throw new FetchPdfError('This PDF is larger than the 50 MB limit', 413)
  }

  // Buffered rather than streamed: lets us check the header first and enforce the size cap.
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  let checkedHeader = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size > MAX_PDF_BYTES) {
      await reader.cancel()
      throw new FetchPdfError('This PDF is larger than the 50 MB limit', 413)
    }
    // Bail out early on HTML pages and the like (smaller bodies are checked after the loop).
    if (!checkedHeader && size >= HEADER_WINDOW) {
      checkedHeader = true
      if (!hasPdfHeader(concat(chunks, HEADER_WINDOW))) {
        await reader.cancel()
        return { notPdf: true }
      }
    }
  }
  const body = concat(chunks, size)
  if (!hasPdfHeader(body)) return { notPdf: true }

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    body,
    headers: {
      'content-type': 'application/pdf',
      'cache-control': 'max-age=3600',
      'x-upsert': 'false',
      ...(anonKey ? { apikey: anonKey } : {}),
    },
  })
  if (!upload.ok) {
    const detail = await upload.text().catch(() => '')
    throw new FetchPdfError(`Saving the PDF failed (${upload.status}) ${detail}`.trim(), 502)
  }

  return { notPdf: false, finalUrl, size, filename: filenameFor(res, finalUrl) }
}

/** @param {Uint8Array[]} chunks @param {number} length */
function concat(chunks, length) {
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= length) break
    const take = Math.min(chunk.byteLength, length - offset)
    out.set(chunk.subarray(0, take), offset)
    offset += take
  }
  return out
}
