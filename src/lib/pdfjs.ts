// Lazy loader for pdf.js (~1.5 MB with its worker), so it only downloads once a PDF is opened or
// uploaded. The data files it fetches at runtime are served under /pdfjs/ (see vite.config.ts).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PdfjsLib = typeof import('pdfjs-dist')
type PdfjsViewer = typeof import('pdfjs-dist/web/pdf_viewer.mjs')
export type PDFDocumentProxy = import('pdfjs-dist').PDFDocumentProxy

let loading: Promise<{ lib: PdfjsLib; viewer: PdfjsViewer }> | null = null

/** The viewer module reads `globalThis.pdfjsLib` when it evaluates, so it loads second. */
export function loadPdfjs(): Promise<{ lib: PdfjsLib; viewer: PdfjsViewer }> {
  loading ??= (async () => {
    const lib = await import('pdfjs-dist')
    lib.GlobalWorkerOptions.workerSrc = workerUrl
    ;(globalThis as unknown as { pdfjsLib: PdfjsLib }).pdfjsLib = lib
    const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs')
    return { lib, viewer }
  })()
  return loading
}

/** Copies `data`: pdf.js transfers (detaches) the buffer it's given to its worker. */
export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const { lib } = await loadPdfjs()
  return lib.getDocument({
    data: new Uint8Array(data.slice(0)),
    cMapUrl: '/pdfjs/cmaps/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    enableXfa: false,
  }).promise
}

/** True if the bytes look like a PDF (readers accept the header anywhere in the first 1 KB). */
export function hasPdfHeader(data: ArrayBuffer): boolean {
  const head = new TextDecoder('latin1').decode(
    new Uint8Array(data, 0, Math.min(1024, data.byteLength)),
  )
  return head.includes('%PDF-')
}

/** Page count and the document's own Title (often empty or junk like "untitled"). */
export async function readPdfInfo(
  data: ArrayBuffer,
): Promise<{ pageCount: number; title: string | null }> {
  const doc = await openPdf(data)
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const info = meta?.info as { Title?: unknown } | undefined
    const raw = typeof info?.Title === 'string' ? info.Title.trim() : ''
    const title = raw && !/^(untitled|microsoft word|document\d*)\b/i.test(raw) ? raw : null
    return { pageCount: doc.numPages, title }
  } finally {
    void doc.loadingTask.destroy()
  }
}
