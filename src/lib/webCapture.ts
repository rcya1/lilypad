/**
 * Result of `POST /api/capture`: the Vite dev middleware (vite.config.ts), or a Vercel function in
 * production.
 */
export interface CaptureResult {
  /** Inert and self-contained: scripts and forms are stripped server-side. */
  html: string
  title: string
  /** After redirects. */
  finalUrl: string
}

/** Overridable via `VITE_CAPTURE_URL`. */
const CAPTURE_URL = import.meta.env.VITE_CAPTURE_URL ?? '/api/capture'

/** Throws with a readable message on failure. */
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
