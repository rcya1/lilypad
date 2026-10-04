// Client for `POST /api/fetch-pdf`: the server fetches a PDF from a URL (most hosts don't allow
// cross-origin fetches) and uploads it straight into a signed Storage URL.

/** Matches tools/fetch-pdf.mjs and Supabase's default per-file limit. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024

export type FetchPdfResult =
  | { notPdf: true }
  | { notPdf: false; finalUrl: string; size: number; filename: string | null }

/** Overridable via `VITE_FETCH_PDF_URL`. */
const FETCH_PDF_URL = import.meta.env.VITE_FETCH_PDF_URL ?? '/api/fetch-pdf'

/** `notPdf` means the URL is some other page (capture it as a web page instead). Throws on failure. */
export async function fetchPdfIntoStorage(url: string, uploadUrl: string): Promise<FetchPdfResult> {
  const res = await fetch(FETCH_PDF_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, uploadUrl }),
  })
  if (!res.ok) {
    let message = `Fetching the PDF failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // non-JSON error body; keep the status-based message
    }
    throw new Error(message)
  }
  return (await res.json()) as FetchPdfResult
}

/** "paper.pdf" for a name without the extension; path separators replaced. */
export function pdfFileName(raw: string): string {
  const base = raw.replace(/[/\\]+/g, '-').trim() || 'Untitled'
  return /\.pdf$/i.test(base) ? base.replace(/\.pdf$/i, '.pdf') : `${base}.pdf`
}
