// Vercel function for `POST /api/fetch-pdf` in production (dev uses the Vite middleware). The work
// is tools/fetch-pdf.mjs: fetch a PDF from a URL and upload it to a signed Storage URL.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchPdfToStorage, FetchPdfError } from '../tools/fetch-pdf.mjs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  if (!supabaseUrl) {
    res.status(500).json({ error: 'VITE_SUPABASE_URL is not configured' })
    return
  }

  const body = (req.body ?? {}) as { url?: unknown; uploadUrl?: unknown }
  try {
    const result = await fetchPdfToStorage({
      url: body.url,
      uploadUrl: body.uploadUrl,
      supabaseUrl,
      anonKey: process.env.VITE_SUPABASE_ANON_KEY,
    })
    res.status(200).json(result)
  } catch (err) {
    const status = err instanceof FetchPdfError ? err.status : 500
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
