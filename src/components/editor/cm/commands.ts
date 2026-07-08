// CodeMirror commands for indenting/dedenting markdown bullet lines.
import type { Command } from '@codemirror/view'

/**
 * Tab key command: indent a markdown bullet line by 2 spaces.
 * Returns false (deferring to default Tab behaviour) if the current line is not a bullet.
 * seenLines deduplicates multi-cursor ranges that land on the same line.
 */
export const indentBullet: Command = (editorView) => {
  const { state } = editorView
  const seenLines = new Set<number>()
  const changes: { from: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from)
    if (seenLines.has(line.number)) continue
    if (!/^\s*-\s/.test(line.text)) return false
    seenLines.add(line.number)
    changes.push({ from: line.from, insert: '  ' })
  }
  if (changes.length === 0) return false
  editorView.dispatch(state.update({ changes, scrollIntoView: true }))
  return true
}

/**
 * Shift+Tab command: dedent a markdown bullet line by removing 2 leading spaces.
 * Returns false if the line is not a bullet, or if there are fewer than 2 leading spaces.
 */
export const dedentBullet: Command = (editorView) => {
  const { state } = editorView
  const seenLines = new Set<number>()
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from)
    if (seenLines.has(line.number)) continue
    if (!/^\s*-\s/.test(line.text)) return false
    if (!line.text.startsWith('  ')) return false
    seenLines.add(line.number)
    changes.push({ from: line.from, to: line.from + 2, insert: '' })
  }
  if (changes.length === 0) return false
  editorView.dispatch(state.update({ changes, scrollIntoView: true }))
  return true
}
