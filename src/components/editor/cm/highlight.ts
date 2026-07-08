// CodeMirror StateEffect/StateField pairs for the search-result line flash and yank flash.
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

// StateEffect/StateField pair for the line-flash highlight triggered by search result navigation.
// The effect carries the 1-based line number to highlight, or null to clear.
export const highlightLineEffect = StateEffect.define<number | null>()

export const highlightLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(highlightLineEffect)) {
        if (effect.value == null) return Decoration.none
        const line = tr.state.doc.line(effect.value)
        return Decoration.set([Decoration.line({ class: 'cm-highlight-line' }).range(line.from)])
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

// StateEffect/StateField pair for the yank flash (brief highlight of the yanked range).
// value.map(tr.changes) keeps the range valid as the document is edited — without this,
// a document change could make stored positions point to the wrong characters.
export const yankFlashEffect = StateEffect.define<{ from: number; to: number } | null>()

export const yankFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    // Remap positions against document changes so the flash decoration stays accurate
    // if the user types while the flash is still visible.
    value = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(yankFlashEffect)) {
        if (effect.value == null) return Decoration.none
        const { from, to } = effect.value
        if (from >= to) return Decoration.none
        return Decoration.set([Decoration.mark({ class: 'cm-yank-flash' }).range(from, to)])
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})
