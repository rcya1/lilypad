// Client-side module for freezing a URL into an inert HTML snapshot via the /api/capture endpoint.
/**
 * Client-side entry point for capturing a web page into a frozen snapshot.
 *
 * Calls `POST /api/capture`, served in dev by the Vite middleware (`devCapturePlugin` in
 * vite.config.ts) and in production by a Vercel serverless function. Returns the inert,
 * self-contained HTML plus the page title and the final (post-redirect) URL.
 */

export interface CaptureResult {
  /** Inert, self-contained HTML — scripts and forms are stripped by the capture server. */
  html: string
  /** Page `<title>` at the time of capture. */
  title: string
  /** The final URL after following any redirects; may differ from the URL passed to captureWebPage. */
  finalUrl: string
}

/** Override the capture endpoint via `VITE_CAPTURE_URL`; defaults to the same-origin `/api/capture`. */
const CAPTURE_URL = import.meta.env.VITE_CAPTURE_URL ?? '/api/capture'

/**
 * Capture a URL as a frozen web snapshot via the `/api/capture` endpoint.
 *
 * @param url - The URL to capture (must be http/https; validation is done server-side).
 * @returns   The rendered HTML, page title, and final URL.
 * @throws    Error with a human-readable message on non-2xx responses or network failure.
 */
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
