// Line flash (from search results) and yank flash decorations.
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

// Carries the 1-based line to flash, or null to clear.
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

export const yankFlashEffect = StateEffect.define<{ from: number; to: number } | null>()

export const yankFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    // Keep the range on the right text if the user types during the flash.
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
