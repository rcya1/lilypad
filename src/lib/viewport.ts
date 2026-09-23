// Viewport breakpoint shared by the router's small-viewport → reader redirect and anything that
// needs to know whether that redirect would fire (e.g. before stripping `?desktop=1`).

/** Below this viewport width, navigating to the desktop app route redirects to the reader. */
export const MOBILE_BREAKPOINT = 768

/** True when the desktop route would redirect to the reader without a `?desktop=1` opt-out. */
export function isSmallViewport(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}
