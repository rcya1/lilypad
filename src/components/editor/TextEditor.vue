<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{ documentId: string }>()

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

function buildState(content: string) {
  return EditorState.create({
    doc: content,
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
  })
}

function mountView(documentId: string) {
  if (!container.value) return
  const doc = store.openDocuments.get(documentId)
  const content = doc?.content ?? ''

  if (view) {
    // Swap the state in place to avoid flickering; recreate if container changed
    view.setState(buildState(content))
  } else {
    view = new EditorView({
      state: buildState(content),
      parent: container.value,
    })
  }
  view.focus()
}

onMounted(() => mountView(props.documentId))

watch(
  () => props.documentId,
  (newId) => mountView(newId),
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="container" class="h-full w-full overflow-hidden" />
</template>
