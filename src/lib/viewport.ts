/** Below this width, the desktop app redirects to the reader. */
export const MOBILE_BREAKPOINT = 768

/** Whether that redirect would fire (absent `?desktop=1`). */
export function isSmallViewport(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}
