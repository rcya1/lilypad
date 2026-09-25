// Anchors highlights in captured pages. The snapshot never changes, so character offsets into its
// text are a stable anchor. Offsets count text nodes in document order, exactly as
// `Range.toString()` does, so serializing and resolving round-trip.

import type { HighlightSelectors } from '@/types/database'

/** Context kept on each side of the quote. */
const CONTEXT_LEN = 40

/** Counts like `Range.toString()`, so `container` may be a text node or an element. */
function offsetWithin(root: Node, container: Node, offset: number): number {
  const doc = root.ownerDocument
  if (!doc) return 0
  const pre = doc.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(container, offset)
  return pre.toString().length
}

/** Null for a collapsed range. */
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

/** Clamped to the end of the text if `target` runs past it. */
function locate(root: Node, target: number): { node: Text; offset: number } | null {
  const doc = root.ownerDocument
  if (!doc) return null
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let last: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.data.length
    if (target <= consumed + len) {
      return { node, offset: Math.max(0, target - consumed) }
    }
    consumed += len
    last = node
    node = walker.nextNode() as Text | null
  }
  // Past the end: clamp.
  if (last) return { node: last, offset: last.data.length }
  return null
}

/** Null if the offsets can't be located (e.g. an empty document): an orphaned highlight. */
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
