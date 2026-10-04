// Geometry helpers for PDF highlights. A selection in pdf.js's text layer yields one rect per span
// fragment (often several per word); these are merged into one box per line before being stored.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Boxes on the same line: their vertical overlap is at least half the shorter one's height. */
function sameLine(a: Box, b: Box): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  const minHeight = Math.min(a.bottom - a.top, b.bottom - b.top)
  return minHeight > 0 && overlap >= minHeight / 2
}

/**
 * Merges boxes that sit on the same line and touch or nearly touch (a gap under one line-height,
 * i.e. a word space), so a highlighted line paints as one band. Empty boxes are dropped.
 */
export function mergeLineBoxes(boxes: Box[]): Box[] {
  const sorted = boxes
    .filter((b) => b.right - b.left > 0.5 && b.bottom - b.top > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left)
  const merged: Box[] = []
  for (const box of sorted) {
    const gapLimit = box.bottom - box.top
    const target = merged.find(
      (m) => sameLine(m, box) && box.left - m.right <= gapLimit && m.left - box.right <= gapLimit,
    )
    if (target) {
      target.left = Math.min(target.left, box.left)
      target.top = Math.min(target.top, box.top)
      target.right = Math.max(target.right, box.right)
      target.bottom = Math.max(target.bottom, box.bottom)
    } else {
      merged.push({ ...box })
    }
  }
  return merged
}

/** Whitespace runs (including the text layer's line breaks) collapsed to single spaces. */
export function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
