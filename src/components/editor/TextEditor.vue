<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { vim, getCM, Vim } from '@replit/codemirror-vim'
import { keymap } from '@codemirror/view'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{ documentId: string; isActive: boolean }>()

const store = useEditorStore()
const container = ref<HTMLDivElement>()
let view: EditorView | null = null

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

onBeforeUnmount(() => {
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
