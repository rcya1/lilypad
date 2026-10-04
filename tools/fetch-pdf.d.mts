export const MAX_PDF_BYTES: number
export class FetchPdfError extends Error {
  status: number
  constructor(message: string, status: number)
}
export type FetchPdfResult =
  | { notPdf: true }
  | { notPdf: false; finalUrl: string; size: number; filename: string | null }
export function fetchPdfToStorage(input: {
  url: unknown
  uploadUrl: unknown
  supabaseUrl: string
  anonKey?: string
}): Promise<FetchPdfResult>
