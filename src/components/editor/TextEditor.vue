<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{ documentId: string; isActive: boolean }>()

const store = useEditorStore()
const container = ref<HTMLDivElement>()
let view: EditorView | null = null

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
    padding: '20px 0',
  },
  '.cm-line': {
    padding: '0 16px',
  },
  '.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--accent)',
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
  view = new EditorView({
    state: EditorState.create({
      doc: doc?.content ?? '',
      extensions: [
        basicSetup,
        lilypadTheme,
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
  view.focus()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="container" class="h-full w-full overflow-hidden" />
</template>
