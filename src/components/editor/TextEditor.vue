<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { vim, getCM, Vim } from '@replit/codemirror-vim'
import { useEditorStore } from '@/stores/editor'

const highlightLineEffect = StateEffect.define<number | null>()

const highlightLineField = StateField.define<DecorationSet>({
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

const props = defineProps<{ documentId: string; isActive: boolean }>()

const store = useEditorStore()
const container = ref<HTMLDivElement>()
let view: EditorView | null = null
let highlightTimer: ReturnType<typeof setTimeout> | undefined

const vimMode = ref<'normal' | 'insert' | 'visual' | 'replace'>('normal')

const modeLabel = computed(() => {
  switch (vimMode.value) {
    case 'insert':
      return '-- INSERT --'
    case 'visual':
      return '-- VISUAL --'
    case 'replace':
      return '-- REPLACE --'
    default:
      return ''
  }
})

const modeLabelClass = computed(() => {
  switch (vimMode.value) {
    case 'insert':
      return 'text-accent'
    case 'visual':
      return 'text-amber'
    case 'replace':
      return 'text-text-secondary'
    default:
      return ''
  }
})

const lilypadTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--bg)',
    color: 'var(--text-primary)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
    overflow: 'auto',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '10px 0',
    paddingBottom: '50vh',
  },
  '.cm-line': {
    padding: '0 8px',
  },
  '.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-selectionLayer': {
    zIndex: '2 !important',
    mixBlendMode: 'darken',
    pointerEvents: 'none',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--surface-overlay) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--surface-overlay) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
    minWidth: '48px',
  },
  '.cm-gutterElement': {
    padding: '0 12px 0 8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-secondary)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--surface) !important',
  },
  '.cm-highlight-line.cm-activeLine, .cm-highlight-line': {
    animation: 'cm-line-flash 1.5s ease-out forwards !important',
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--surface-elevated)',
  },
  '.cm-fat-cursor': {
    background: 'color-mix(in srgb, var(--accent) 35%, transparent) !important',
    color: 'var(--text-primary) !important',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    background: 'none !important',
    outline: '1px solid color-mix(in srgb, var(--accent) 50%, transparent) !important',
    color: 'transparent !important',
  },
})

watch(
  () => props.isActive,
  (active) => {
    if (active && view) {
      requestAnimationFrame(() => {
        view?.requestMeasure()
        view?.focus()
      })
    }
  },
)

onMounted(() => {
  if (!container.value) return

  const doc = store.openDocuments.get(props.documentId)
  // Register :w command before creating the view
  Vim.defineEx('w', 'w', () => {
    store.saveDocument(props.documentId)
  })

  view = new EditorView({
    state: EditorState.create({
      doc: doc?.content ?? '',
      extensions: [
        vim(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              store.saveDocument(props.documentId)
              return true
            },
          },
        ]),
        basicSetup,
        lilypadTheme,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            store.updateContent(props.documentId, update.state.doc.toString())
          }
        }),
        EditorView.lineWrapping,
        highlightLineField,
      ],
    }),
    parent: container.value,
  })

  const cm = getCM(view)
  cm?.on('vim-mode-change', (e: { mode: string }) => {
    vimMode.value = e.mode as typeof vimMode.value
  })

  view.focus()
})

watch(
  () => store.scrollToLineRequest,
  (req) => {
    if (!req || req.documentId !== props.documentId || !view) return
    store.scrollToLineRequest = null

    const targetLine = Math.min(Math.max(1, req.line), view.state.doc.lines)
    const lineInfo = view.state.doc.line(targetLine)

    view.dispatch({
      effects: [
        EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
        highlightLineEffect.of(targetLine),
      ],
    })

    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      view?.dispatch({ effects: highlightLineEffect.of(null) })
    }, 1500)
  },
)

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
  view?.destroy()
  view = null
})
</script>

<template>
  <div class="h-full w-full flex flex-col overflow-hidden">
    <div ref="container" class="flex-1 overflow-hidden" />
    <div class="flex items-center h-6 px-3 shrink-0 border-t border-border-subtle bg-surface">
      <span class="font-mono text-xs font-medium tracking-wide" :class="modeLabelClass">
        {{ modeLabel }}
      </span>
    </div>
  </div>
</template>

<style>
@keyframes cm-line-flash {
  0% {
    background-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  100% {
    background-color: transparent;
  }
}
</style>
