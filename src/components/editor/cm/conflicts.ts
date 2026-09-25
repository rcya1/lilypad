// CodeMirror support for merge conflicts left by offline sync (VS Code style): tints the two sides
// of each `<<<<<<<` … `=======` … `>>>>>>>` block, and puts "Accept mine · Accept theirs · Accept
// both" links above it. The markers are plain text, so editing them by hand works too.
// Also: the annotation that marks edits coming from outside the editor (sync), not the user.
import { Annotation, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { findConflicts, resolveConflict, type ConflictChoice } from '@/lib/merge'

/** Marks a transaction as a change from outside the editor (not the user's typing). */
export const externalEdit = Annotation.define<boolean>()

/**
 * Replaces the document with `next` by changing only the differing middle section, so the
 * cursor and scroll position survive when the edit is elsewhere.
 */
export function replaceDocMinimally(view: EditorView, next: string) {
  const current = view.state.doc.toString()
  if (current === next) return
  let start = 0
  const maxStart = Math.min(current.length, next.length)
  while (start < maxStart && current.charCodeAt(start) === next.charCodeAt(start)) start++
  let endCur = current.length
  let endNext = next.length
  while (
    endCur > start &&
    endNext > start &&
    current.charCodeAt(endCur - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCur--
    endNext--
  }
  view.dispatch({
    changes: { from: start, to: endCur, insert: next.slice(start, endNext) },
    annotations: externalEdit.of(true),
  })
}

const CHOICES: [ConflictChoice, string][] = [
  ['mine', 'Accept mine'],
  ['theirs', 'Accept theirs'],
  ['both', 'Accept both'],
]

class ConflictActionsWidget extends WidgetType {
  constructor(readonly index: number) {
    super()
  }

  eq(other: ConflictActionsWidget) {
    return other.index === this.index
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-conflict-actions'
    CHOICES.forEach(([choice, label], i) => {
      if (i > 0) wrap.append(document.createTextNode(' · '))
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-conflict-action'
      button.textContent = label
      // mousedown so the editor doesn't take focus/selection first.
      button.addEventListener('mousedown', (e) => {
        e.preventDefault()
        resolveAt(view, this.index, choice)
      })
      wrap.append(button)
    })
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

function resolveAt(view: EditorView, index: number, choice: ConflictChoice) {
  const text = view.state.doc.toString()
  const block = findConflicts(text)[index]
  if (!block) return
  view.dispatch({ changes: resolveConflict(text, block, choice), userEvent: 'input.resolve' })
}

function buildDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString()
  if (!text.includes('<<<<<<<')) return Decoration.none
  const blocks = findConflicts(text)
  if (blocks.length === 0) return Decoration.none

  const decorations: Range<Decoration>[] = []
  blocks.forEach((block, i) => {
    decorations.push(
      Decoration.widget({ widget: new ConflictActionsWidget(i), block: true, side: -1 }).range(
        block.startLine,
      ),
    )
    const start = state.doc.lineAt(block.startLine).number
    const separator = state.doc.lineAt(block.separatorLine).number
    const end = state.doc.lineAt(block.endLine).number
    for (let n = start; n <= end; n++) {
      const cls =
        n === start || n === separator || n === end
          ? 'cm-conflict-marker'
          : n < separator
            ? 'cm-conflict-mine'
            : 'cm-conflict-theirs'
      decorations.push(Decoration.line({ class: cls }).range(state.doc.line(n).from))
    }
  })
  return Decoration.set(decorations, true)
}

/** Decorations for conflict blocks (block widgets must come from a state field). */
export const conflictMarkers = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    return tr.docChanged ? buildDecorations(tr.state) : value
  },
  provide: (field) => EditorView.decorations.from(field),
})
