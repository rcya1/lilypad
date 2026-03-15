<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { parseMarkdown } from '@/lib/markdown'
import 'katex/dist/katex.min.css'

const props = defineProps<{ documentId: string }>()

const store = useEditorStore()
const html = ref('')
const renderKey = ref(0)
const scrollContainer = useTemplateRef<HTMLDivElement>('scrollContainer')

const selectedLine = ref<number | null>(null)
const hoveredLine = ref<number | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | undefined

function render(content: string) {
  html.value = parseMarkdown(content)
  renderKey.value++
}

onMounted(() => {
  const doc = store.openDocuments.get(props.documentId)
  render(doc?.content ?? '')
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

watch(
  () => store.openDocuments.get(props.documentId)?.content,
  (content) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => render(content ?? ''), 5)
  },
)

watch(
  () => props.documentId,
  () => {
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0
  },
)

// --- Selectable block helpers ---

function getSelectableElements(): HTMLElement[] {
  const container = scrollContainer.value?.querySelector('.markdown-body')
  if (!container) return []
  // Filter out list containers (ul/ol) that wrap annotated <li> children —
  // but keep <li> elements even if they contain nested lists, since they have
  // their own content worth selecting.
  return (Array.from(container.querySelectorAll('[data-source-line]')) as HTMLElement[]).filter(
    (el) => {
      const tag = el.tagName.toLowerCase()
      if ((tag === 'ul' || tag === 'ol') && el.querySelector('[data-source-line]')) return false
      return true
    },
  )
}

function getSourceLine(el: HTMLElement): number {
  return parseInt(el.getAttribute('data-source-line') || '', 10)
}

// --- Mouse handlers ---

function findSelectableSourceLine(el: HTMLElement): HTMLElement | null {
  const target = el.closest?.('[data-source-line]') as HTMLElement | null
  if (!target) return null
  const tag = target.tagName.toLowerCase()
  // If we hit a list container (ul/ol), don't highlight anything —
  // the cursor is in the gap between items, not over actual content
  if ((tag === 'ul' || tag === 'ol') && target.querySelector('[data-source-line]')) return null
  return target
}

function onMouseOver(event: MouseEvent) {
  const target = findSelectableSourceLine(event.target as HTMLElement)
  if (!target) {
    hoveredLine.value = null
    return
  }
  const line = getSourceLine(target)
  if (!Number.isNaN(line) && line !== hoveredLine.value) {
    hoveredLine.value = line
  }
}

function onMouseLeave() {
  hoveredLine.value = null
}

function onClick(event: MouseEvent) {
  const target = findSelectableSourceLine(event.target as HTMLElement)
  if (!target) {
    selectedLine.value = null
    return
  }
  const line = getSourceLine(target)
  if (Number.isNaN(line)) return
  selectedLine.value = line
  store.setPreviewCursor(props.documentId, line)
  store.setFocusedPane('preview')
  // Ensure the container has focus for keyboard nav
  scrollContainer.value?.focus()
}

// --- Keyboard handler ---

function onKeyDown(event: KeyboardEvent) {
  const key = event.key

  if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
    event.preventDefault()
    const elements = getSelectableElements()
    if (elements.length === 0) return

    const direction = key === 'j' || key === 'ArrowDown' ? 1 : -1

    if (selectedLine.value == null) {
      // Select first or last element
      const el = direction === 1 ? elements[0]! : elements[elements.length - 1]!
      const line = getSourceLine(el)
      selectedLine.value = line
      store.setPreviewCursor(props.documentId, line)
      el.scrollIntoView({ block: 'nearest' })
      return
    }

    // Find current index
    const currentIdx = elements.findIndex((el) => getSourceLine(el) === selectedLine.value)
    const nextIdx = Math.max(0, Math.min(elements.length - 1, currentIdx + direction))
    const nextEl = elements[nextIdx]!
    const line = getSourceLine(nextEl)
    selectedLine.value = line
    store.setPreviewCursor(props.documentId, line)
    nextEl.scrollIntoView({ block: 'nearest' })
  } else if (key === 'y') {
    if (selectedLine.value == null) return
    const container = scrollContainer.value?.querySelector('.markdown-body')
    if (!container) return
    const el = findSelectableByLine(container, selectedLine.value)
    if (el?.textContent) {
      navigator.clipboard.writeText(el.textContent)
    }
  } else if (key === 'Escape') {
    store.setFocusedPane('editor')
    scrollContainer.value?.blur()
  }
}

// --- Focus management ---

function onFocus() {
  store.setFocusedPane('preview')
}

function onBlur() {
  selectedLine.value = null
}

watch(
  () => store.focusedPane,
  (pane) => {
    if (pane === 'editor') {
      scrollContainer.value?.blur()
    }
  },
)

// --- Highlight class management ---

/** Find the selectable element for a given source line (skip ul/ol containers) */
function findSelectableByLine(container: Element, line: number): Element | null {
  const all = container.querySelectorAll(`[data-source-line="${line}"]`)
  for (const el of all) {
    const tag = el.tagName.toLowerCase()
    if ((tag === 'ul' || tag === 'ol') && el.querySelector('[data-source-line]')) continue
    return el
  }
  return null
}

function updateHighlights() {
  const container = scrollContainer.value?.querySelector('.markdown-body')
  if (!container) return

  container.querySelectorAll('.preview-hover').forEach((el) => el.classList.remove('preview-hover'))
  container
    .querySelectorAll('.preview-selected')
    .forEach((el) => el.classList.remove('preview-selected'))

  if (hoveredLine.value != null && hoveredLine.value !== selectedLine.value) {
    findSelectableByLine(container, hoveredLine.value)?.classList.add('preview-hover')
  }

  if (selectedLine.value != null) {
    findSelectableByLine(container, selectedLine.value)?.classList.add('preview-selected')
  }
}

watch([hoveredLine, selectedLine], updateHighlights)
watch(renderKey, () =>
  nextTick(() => {
    updateHighlights()
    syncFromEditorCursor()
  }),
)

// --- Sync from store ---

watch(
  () => store.previewCursorLine.get(props.documentId),
  (line) => {
    if (line != null) selectedLine.value = line
  },
)

// When the editor cursor moves, highlight the closest block in the preview
function syncFromEditorCursor() {
  const cursorLine = store.editorCursorLine.get(props.documentId)
  if (cursorLine == null || store.focusedPane !== 'editor') return
  const elements = getSelectableElements()
  if (elements.length === 0) return
  let best: HTMLElement | null = null
  let bestLine = -1
  for (const el of elements) {
    const line = getSourceLine(el)
    if (line <= cursorLine && line > bestLine) {
      bestLine = line
      best = el
    }
  }
  if (best && bestLine !== selectedLine.value) {
    selectedLine.value = bestLine
    best.scrollIntoView({ block: 'nearest' })
  }
}

watch(() => store.editorCursorLine.get(props.documentId), syncFromEditorCursor)
</script>

<template>
  <div
    ref="scrollContainer"
    class="h-full overflow-y-auto bg-surface outline-none"
    tabindex="0"
    @mouseover="onMouseOver"
    @mouseleave="onMouseLeave"
    @click="onClick"
    @keydown="onKeyDown"
    @focus="onFocus"
    @blur="onBlur"
  >
    <div
      :key="renderKey"
      class="markdown-body preview-fade m-2 rounded-md bg-bg px-5 py-5 font-preview text-[15px] leading-[1.6] text-text-primary border border-border-subtle"
      v-html="html"
    />
  </div>
</template>

<style scoped>
@keyframes preview-fade-in {
  0% {
    opacity: 0.95;
  }
  100% {
    opacity: 1;
  }
}

.preview-fade {
  animation: preview-fade-in 200ms ease;
}

.markdown-body {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.07),
    0 2px 10px rgba(0, 0, 0, 0.04);
}

/* Hover highlight — light */
.markdown-body :deep([data-source-line].preview-hover) {
  background-color: var(--surface-elevated);
  border-radius: 3px;
  transition: background-color 100ms ease;
}

/* Selected — darker */
.markdown-body :deep([data-source-line].preview-selected) {
  background-color: var(--surface-overlay);
  border-radius: 3px;
}

/* Prevent highlighted li from painting over nested lists */
.markdown-body :deep(li.preview-hover > ul),
.markdown-body :deep(li.preview-hover > ol),
.markdown-body :deep(li.preview-selected > ul),
.markdown-body :deep(li.preview-selected > ol) {
  background-color: var(--bg);
  border-radius: 3px;
}

/* Headings */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-family: var(--font-family-preview);
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.1em;
  margin-bottom: 0.5em;
  color: var(--text-primary);
}

.markdown-body :deep(h1):first-child,
.markdown-body :deep(h2):first-child,
.markdown-body :deep(h3):first-child,
.markdown-body :deep(h4):first-child,
.markdown-body :deep(h5):first-child,
.markdown-body :deep(h6):first-child {
  margin-top: 0;
}

.markdown-body :deep(h1) {
  font-size: 1.75rem;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 0.3em;
  margin-top: 0;
}
.markdown-body :deep(h2) {
  font-size: 1.5rem;
  border-bottom: 1px solid var(--text-primary);
  padding-bottom: 0.2em;
}
.markdown-body :deep(h3) {
  font-size: 1.25rem;
  border-bottom: 1px solid var(--text-primary);
  padding-bottom: 0.15em;
}
.markdown-body :deep(h4) {
  font-size: 1.1rem;
  border-bottom: 1px solid var(--text-primary);
  padding-bottom: 0.15em;
}
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 1rem;
}

/* Paragraphs & spacing */
.markdown-body :deep(p) {
  margin: 0.75em 0;
}

/* Links */
.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.markdown-body :deep(a:hover) {
  opacity: 0.8;
}

/* Inline code */
.markdown-body :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  background: var(--surface-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 0.1em 0.35em;
  color: var(--text-primary);
}

/* Code blocks */
.markdown-body :deep(pre) {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 1em 0;
}
.markdown-body :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.82rem;
  line-height: 1.6;
}

/* Blockquotes */
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--border);
  margin: 1em 0;
  padding: 0.4em 1em;
  color: var(--text-secondary);
}
.markdown-body :deep(blockquote p) {
  margin: 0;
}

/* Lists */
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 2em;
  margin-top: 0.15em;
  margin-bottom: 0.75em;
}
.markdown-body :deep(ul) {
  list-style-type: disc;
}
.markdown-body :deep(ol) {
  list-style-type: decimal;
}
.markdown-body :deep(ul ul) {
  list-style-type: circle;
}
.markdown-body :deep(ul ul ul) {
  list-style-type: square;
}
.markdown-body :deep(li) {
  margin: 0.2em 0;
}
.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin: 0.1em 0;
}

/* Tables */
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.9em;
}
.markdown-body :deep(th) {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 6px 12px;
  font-weight: 600;
  text-align: left;
}
.markdown-body :deep(td) {
  border: 1px solid var(--border-subtle);
  padding: 6px 12px;
}
.markdown-body :deep(tr:nth-child(even) td) {
  background: var(--surface);
}

/* Horizontal rule */
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 1.5em 0;
}

/* Images */
.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

/* KaTeX display blocks */
.markdown-body :deep(.katex-display) {
  margin: 1em 0;
}

/* Admonitions */
.markdown-body :deep(.admonition) {
  border-radius: 6px;
  border-left: 3px solid var(--border);
  background: var(--surface);
  margin: 1.25em 0;
  overflow: hidden;
}

.markdown-body :deep(.admonition-title) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-weight: 600;
  background: var(--surface-elevated);
  border-bottom: 1px solid var(--border-subtle);
}

.markdown-body :deep(.admonition-body) {
  padding: 10px 14px;
}
.markdown-body :deep(.admonition-body > p:first-child) {
  margin-top: 0;
}
.markdown-body :deep(.admonition-body > p:last-child) {
  margin-bottom: 0;
}

/* Admonition type colours */
.markdown-body :deep(.admonition-info) {
  border-left-color: #4a9a9a;
}
.markdown-body :deep(.admonition-info .admonition-title) {
  color: #4a9a9a;
}

.markdown-body :deep(.admonition-definition) {
  border-left-color: var(--amber);
}
.markdown-body :deep(.admonition-definition .admonition-title) {
  color: var(--amber);
}

.markdown-body :deep(.admonition-theorem),
.markdown-body :deep(.admonition-proposition) {
  border-left-color: var(--accent);
}
.markdown-body :deep(.admonition-theorem .admonition-title),
.markdown-body :deep(.admonition-proposition .admonition-title) {
  color: var(--accent);
}
</style>
