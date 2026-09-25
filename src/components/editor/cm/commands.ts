// CodeMirror commands for indenting/dedenting markdown bullet lines.
import type { Command } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'

/**
 * Lines a selection covers, not counting a final line it only reaches at column 0 (as editors do
 * when indenting a block).
 */
function lineSpan(state: EditorState, from: number, to: number): [number, number] {
  const startLine = state.doc.lineAt(from).number
  let endLine = state.doc.lineAt(to).number
  if (endLine > startLine && to === state.doc.line(endLine).from) endLine--
  return [startLine, endLine]
}

/** Indents each bullet line the selection touches by 2 spaces; false (default Tab) if none. */
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

/** Dedents by 2 spaces; false (default Shift+Tab) if no line can be dedented. */
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
