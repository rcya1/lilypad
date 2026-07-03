export interface CaptureResult {
  html: string
  title: string
  finalUrl: string
}
export function captureUrl(url: string): Promise<CaptureResult>
export function serializeSnapshot(page: unknown): Promise<CaptureResult>
export function assertCapturableUrl(rawUrl: string): Promise<void>
export function navigateForCapture(page: unknown, url: string): Promise<void>
