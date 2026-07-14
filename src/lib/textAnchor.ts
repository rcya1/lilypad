// Anchors a text selection to a stable position inside a captured web snapshot.
//
// The snapshot is immutable (scripts stripped, never re-rendered), so character offsets into
// the body's text content are a perfectly stable anchor: serialize a DOM Range to
// { start, end } offsets (plus the quoted text for robustness / future re-capture), and later
// resolve those offsets back to a fresh Range. No external library needed — the W3C
// text-position/text-quote model from the design doc, specialized for the immutable-snapshot case.
//
// Offsets are measured over the concatenation of text nodes in document order, which is exactly
// what `Range.prototype.toString()` returns — so serialize (via toString length) and resolve
// (via a text-node TreeWalker) traverse the same character space and round-trip exactly.

import type { HighlightSelectors } from '@/types/database'

/** How many characters of surrounding context to store on each side of the quote. */
const CONTEXT_LEN = 40

/**
 * Character offset of a (container, offset) boundary within `root`'s text, measured the same way
 * `Range.toString()` counts characters. Works whether `container` is a text node or an element
 * (in which case `offset` is a child index) because it delegates to a Range's own `toString()`.
 */
function offsetWithin(root: Node, container: Node, offset: number): number {
  const doc = root.ownerDocument
  if (!doc) return 0
  const pre = doc.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(container, offset)
  return pre.toString().length
}

/**
 * Serialize a live selection Range into stable selectors relative to `root` (the snapshot body).
 * Returns null if the range is collapsed (nothing selected).
 */
export function serializeRange(root: Node, range: Range): HighlightSelectors | null {
  const exact = range.toString()
  if (exact.length === 0) return null

  const start = offsetWithin(root, range.startContainer, range.startOffset)
  const end = start + exact.length

  const full = root.textContent ?? ''
  const prefix = full.slice(Math.max(0, start - CONTEXT_LEN), start)
  const suffix = full.slice(end, end + CONTEXT_LEN)

  return { quote: { exact, prefix, suffix }, position: { start, end } }
}

/**
 * Locate the text node and in-node offset for a global character `target` offset within `root`,
 * walking text nodes in document order. Returns the last valid position (clamped) if `target`
 * runs past the end of the text.
 */
function locate(root: Node, target: number): { node: Text; offset: number } | null {
  const doc = root.ownerDocument
  if (!doc) return null
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let last: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.data.length
    // `target` falls inside (or at the start boundary of) this node.
    if (target <= consumed + len) {
      return { node, offset: Math.max(0, target - consumed) }
    }
    consumed += len
    last = node
    node = walker.nextNode() as Text | null
  }
  // Past the end — clamp to the end of the final text node.
  if (last) return { node: last, offset: last.data.length }
  return null
}

/**
 * Resolve stored selectors back into a live Range within `root`. Uses the exact character
 * positions (reliable because the snapshot never changes). Returns null if the offsets can't be
 * located (e.g. an empty document) — the caller treats that as an orphaned highlight.
 */
export function resolveRange(root: Node, selectors: HighlightSelectors): Range | null {
  const doc = root.ownerDocument
  if (!doc) return null
  const { start, end } = selectors.position
  const from = locate(root, start)
  const to = locate(root, end)
  if (!from || !to) return null
  const range = doc.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  } catch {
    return null
  }
  return range
}
