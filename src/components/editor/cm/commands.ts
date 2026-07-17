// CodeMirror commands for indenting/dedenting markdown bullet lines.
import type { Command } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'

/**
 * Returns the inclusive [startLine, endLine] line-number range that a selection range covers.
 * When the selection ends exactly at the start of a line (a trailing newline is included), that
 * line isn't really "in" the selection, so it's excluded — matching how editors indent blocks.
 */
function lineSpan(state: EditorState, from: number, to: number): [number, number] {
  const startLine = state.doc.lineAt(from).number
  let endLine = state.doc.lineAt(to).number
  if (endLine > startLine && to === state.doc.line(endLine).from) endLine--
  return [startLine, endLine]
}

/**
 * Tab key command: indent every markdown bullet line touched by the selection by 2 spaces.
 * Iterates all lines each selection range spans (not just the first) so a multi-line selection
 * indents together. Non-bullet lines are skipped; returns false (deferring to default Tab) only
 * when the selection touches no bullet lines at all. seenLines dedups overlapping multi-cursor ranges.
 */
export const indentBullet: Command = (editorView) => {
  const { state } = editorView
  const seenLines = new Set<number>()
  const changes: { from: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const [startLine, endLine] = lineSpan(state, range.from, range.to)
    for (let n = startLine; n <= endLine; n++) {
      if (seenLines.has(n)) continue
      seenLines.add(n)
      const line = state.doc.line(n)
      if (!/^\s*-\s/.test(line.text)) continue
      changes.push({ from: line.from, insert: '  ' })
    }
  }
  if (changes.length === 0) return false
  editorView.dispatch(state.update({ changes, scrollIntoView: true }))
  return true
}

/**
 * Shift+Tab command: dedent every markdown bullet line touched by the selection by 2 spaces.
 * Skips lines that aren't bullets or have fewer than 2 leading spaces; returns false (deferring to
 * default Shift+Tab) only when no line in the selection can be dedented.
 */
export const dedentBullet: Command = (editorView) => {
  const { state } = editorView
  const seenLines = new Set<number>()
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const [startLine, endLine] = lineSpan(state, range.from, range.to)
    for (let n = startLine; n <= endLine; n++) {
      if (seenLines.has(n)) continue
      seenLines.add(n)
      const line = state.doc.line(n)
      if (!/^\s*-\s/.test(line.text)) continue
      if (!line.text.startsWith('  ')) continue
      changes.push({ from: line.from, to: line.from + 2, insert: '' })
    }
  }
  if (changes.length === 0) return false
  editorView.dispatch(state.update({ changes, scrollIntoView: true }))
  return true
}
