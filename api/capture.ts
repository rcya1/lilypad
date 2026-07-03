// Vercel serverless function serving `POST /api/capture` in production. Dev instead uses the
// Vite middleware (devCapturePlugin in vite.config.ts). Both wrap the same env-agnostic
// serializeSnapshot() from tools/capture.mjs — this file only supplies the prod Chromium launch.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import chromium from '@sparticuz/chromium'
import { chromium as playwright } from 'playwright-core'
import { assertCapturableUrl, serializeSnapshot } from '../tools/capture.mjs'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const url = (req.body as { url?: unknown } | undefined)?.url
  if (typeof url !== 'string') {
    res.status(400).json({ error: 'A valid http(s) url is required' })
    return
  }
  try {
    await assertCapturableUrl(url)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
    const result = await serializeSnapshot(page)
    res.status(200).json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    await browser.close()
  }
}
