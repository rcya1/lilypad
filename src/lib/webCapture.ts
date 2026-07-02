/**
 * Client-side entry point for capturing a web page into a frozen snapshot.
 *
 * Calls `POST /api/capture`, served in dev by the Vite middleware (`devCapturePlugin` in
 * vite.config.ts) and in production by a Vercel serverless function. Returns the inert,
 * self-contained HTML plus the page title and the final (post-redirect) URL.
 */

export interface CaptureResult {
  html: string
  title: string
  finalUrl: string
}

/** Override the capture endpoint via `VITE_CAPTURE_URL`; defaults to the same-origin `/api/capture`. */
const CAPTURE_URL = import.meta.env.VITE_CAPTURE_URL ?? '/api/capture'

export async function captureWebPage(url: string): Promise<CaptureResult> {
  const res = await fetch(CAPTURE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    let message = `Capture failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // non-JSON error body; keep the status-based message
    }
    throw new Error(message)
  }
  return (await res.json()) as CaptureResult
}
