<!-- Rendered preview of a markdown note. Blocks are selectable and sync with the editor cursor. -->
<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { useAnnotationsStore } from '@/stores/annotations'
import { parseMarkdown } from '@/lib/markdown'
import 'katex/dist/katex.min.css'
// Shared with the reader; the editor-sync styles and card shadow are scoped below.
import '@/assets/markdown-body.css'

const props = defineProps<{ documentId: string }>()

const store = useEditorStore()
const filesStore = useFilesStore()
const uiStore = useUiStore()
const anno = useAnnotationsStore()
const html = ref('')
const scrollContainer = useTemplateRef<HTMLDivElement>('scrollContainer')

const selectedLine = ref<number | null>(null)
const hoveredLine = ref<number | null>(null)

// From the source, so tag names and attributes in the HTML don't count.
const wordCount = computed(() => {
  const content = store.openDocuments.get(props.documentId)?.content ?? ''
  return content.trim().split(/\s+/).filter(Boolean).length
})

let debounceTimer: ReturnType<typeof setTimeout> | undefined

function render(content: string) {
  html.value = parseMarkdown(content, (entryId) => filesStore.getImageUrl(entryId))
}

onMounted(() => {
  const doc = store.openDocuments.get(props.documentId)
  render(doc?.content ?? '')
  const saved = store.previewScrollTop.get(props.documentId)
  if (saved) {
    // Wait for the HTML to be in the DOM, or the container has no height yet.
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = saved
      }
    })
  }
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (scrollContainer.value) {
    store.previewScrollTop.set(props.documentId, scrollContainer.value.scrollTop)
  }
})

// Short enough to be imperceptible, long enough to coalesce bursts of typing.
watch(
  () => store.openDocuments.get(props.documentId)?.content,
  (content) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => render(content ?? ''), 50)
  },
)

/** Every annotated block, minus ul/ol containers (their li items are the targets). */
function getSelectableElements(): HTMLElement[] {
  const container = scrollContainer.value?.querySelector('.markdown-body')
  if (!container) return []
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

/** Nearest annotated block, ignoring ul/ol containers (e.g. clicks between list items). */
function findSelectableSourceLine(el: HTMLElement): HTMLElement | null {
  const target = el.closest?.('[data-source-line]') as HTMLElement | null
  if (!target) return null
  const tag = target.tagName.toLowerCase()
  if ((tag === 'ul' || tag === 'ol') && target.querySelector('[data-source-line]')) return null
  return target
}

function onMouseOver(event: MouseEvent) {
  // Highlight-reference chips mirror their hover to the captured page.
  const refEl = (event.target as HTMLElement).closest?.('[data-lily-ref]') as HTMLElement | null
  if (refEl) {
    const h = anno.findByLocalId(props.documentId, refEl.getAttribute('data-lily-ref') ?? '')
    anno.setHoveredHighlight(h?.id ?? null)
  } else if (anno.hoveredHighlightId) {
    anno.setHoveredHighlight(null)
  }

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
  if (anno.hoveredHighlightId) anno.setHoveredHighlight(null)
}

/** Syncs the editor to the clicked block; clicking empty space clears the selection. */
function onClick(event: MouseEvent) {
  // A highlight-reference chip scrolls the captured page to its highlight.
  const refEl = (event.target as HTMLElement).closest?.('[data-lily-ref]') as HTMLElement | null
  if (refEl) {
    const h = anno.findByLocalId(props.documentId, refEl.getAttribute('data-lily-ref') ?? '')
    if (h) anno.requestScrollToHighlight(h.id)
    return
  }

  const target = findSelectableSourceLine(event.target as HTMLElement)
  if (!target) {
    selectedLine.value = null
    hoveredLine.value = null
    store.requestClearEditorHighlight(props.documentId)
    return
  }
  const line = getSourceLine(target)
  if (Number.isNaN(line)) return
  selectedLine.value = line
  store.setPreviewCursor(props.documentId, line)
  store.setFocusedPane('preview')
  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  // So j/k/y/Escape work straight away.
  scrollContainer.value?.focus()
}

/** Vim-style: j/k (or arrows) move between blocks, y copies one, Escape returns to the editor. */
function onKeyDown(event: KeyboardEvent) {
  const key = event.key

  if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
    event.preventDefault()
    const elements = getSelectableElements()
    if (elements.length === 0) return

    const direction = key === 'j' || key === 'ArrowDown' ? 1 : -1

    if (selectedLine.value == null) {
      const el = direction === 1 ? elements[0]! : elements[elements.length - 1]!
      const line = getSourceLine(el)
      selectedLine.value = line
      store.setPreviewCursor(props.documentId, line)
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return
    }

    const currentIdx = elements.findIndex((el) => getSourceLine(el) === selectedLine.value)
    const nextIdx = Math.max(0, Math.min(elements.length - 1, currentIdx + direction))
    const nextEl = elements[nextIdx]!
    const line = getSourceLine(nextEl)
    selectedLine.value = line
    store.setPreviewCursor(props.documentId, line)
    nextEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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

function onFocus() {
  store.setFocusedPane('preview')
}

function onBlur() {
  selectedLine.value = null
  hoveredLine.value = null
  store.requestClearEditorHighlight(props.documentId)
}

// Drop focus when the editor takes it, so the preview's shortcuts don't interfere.
watch(
  () => store.focusedPane,
  (pane) => {
    if (pane === 'editor') {
      scrollContainer.value?.blur()
    }
  },
)

/** A li and its nested ul can share a line; this returns the non-container one. */
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

  if (hoveredLine.value != null) {
    findSelectableByLine(container, hoveredLine.value)?.classList.add('preview-hover')
  }

  if (selectedLine.value != null) {
    findSelectableByLine(container, selectedLine.value)?.classList.add('preview-selected')
  }
}

// flush: 'sync' so the highlight is never a frame behind the cursor.
watch([hoveredLine, selectedLine], updateHighlights, { flush: 'sync' })

// A re-render replaces the DOM: re-apply the highlights and re-sync with the editor cursor.
watch(html, () =>
  nextTick(() => {
    updateHighlights()
    syncFromEditorCursor()
  }),
)

watch(
  () => store.previewCursorLine.get(props.documentId),
  (line) => {
    if (line != null) selectedLine.value = line
  },
)

/**
 * Selects the block the editor cursor is in (the last block starting at or before its line).
 * Only while the editor has focus, so it doesn't fight click selection.
 */
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
    best.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

watch(() => store.editorCursorLine.get(props.documentId), syncFromEditorCursor)

/** Marks chips whose highlight is active or hovered on the page. */
function updateRefChips() {
  const container = scrollContainer.value?.querySelector('.markdown-body')
  if (!container) return
  container
    .querySelectorAll('.lily-ref-active')
    .forEach((el) => el.classList.remove('lily-ref-active'))
  for (const id of [anno.activeHighlightId, anno.hoveredHighlightId]) {
    const h = id ? anno.getById(id) : null
    if (h && h.entryId === props.documentId) {
      container
        .querySelectorAll(`[data-lily-ref="${CSS.escape(h.localId)}"]`)
        .forEach((el) => el.classList.add('lily-ref-active'))
    }
  }
}

watch(
  () => [anno.activeHighlightId, anno.hoveredHighlightId],
  () => nextTick(updateRefChips),
)
// A re-render replaces the DOM.
watch(html, () => nextTick(updateRefChips))

// A highlight was clicked on the page: scroll to its first chip and flash it.
watch(
  () => anno.scrollToNoteRequest,
  (req) => {
    if (!req || req.entryId !== props.documentId) return
    anno.scrollToNoteRequest = null
    nextTick(() => {
      const container = scrollContainer.value?.querySelector('.markdown-body')
      const chip = container?.querySelector(`[data-lily-ref="${CSS.escape(req.localId)}"]`)
      if (!chip) return
      chip.scrollIntoView({ behavior: 'smooth', block: 'center' })
      chip.classList.add('lily-ref-flash')
      setTimeout(() => chip.classList.remove('lily-ref-flash'), 1200)
    })
  },
)
</script>

<template>
  <div
    ref="scrollContainer"
    class="h-full overflow-y-auto bg-surface outline-none scroll-py-16"
    tabindex="0"
    @mouseover="onMouseOver"
    @mouseleave="onMouseLeave"
    @click="onClick"
    @keydown="onKeyDown"
    @focus="onFocus"
    @blur="onBlur"
  >
    <div
      class="markdown-body mt-2 mb-2 ml-2 mr-4 rounded-md bg-bg px-5 py-5 font-preview leading-[1.6] text-text-primary border border-border-subtle"
      :style="{ fontSize: uiStore.previewFontSize + 'px' }"
      v-html="html"
    />
    <div v-if="wordCount > 0" class="flex justify-end px-4 pb-3 pt-1">
      <span class="text-xs text-text-muted font-ui">{{ wordCount.toLocaleString() }} words</span>
    </div>
  </div>
</template>

<style scoped>
.markdown-body {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.07),
    0 2px 10px rgba(0, 0, 0, 0.04);
}

.markdown-body :deep([data-source-line].preview-hover),
.markdown-body :deep([data-source-line].preview-selected) {
  background-color: var(--surface-elevated);
  border-radius: 4px;
  box-shadow:
    -4px 0 0 0 var(--surface-elevated),
    4px 0 0 0 var(--surface-elevated);
  outline: none;
  width: fit-content;
  transition:
    background-color 100ms ease,
    box-shadow 100ms ease;
}

.markdown-body :deep([data-source-line].preview-hover.preview-selected) {
  background-color: var(--surface-overlay);
  box-shadow:
    -5px 0 0 0 var(--surface-overlay),
    5px 0 0 0 var(--surface-overlay);
}

/* List items: highlight the item's own text (span or p, below), not the whole li with its nested
   lists. The combined-state selector is needed to beat the general combined rule's specificity. */
.markdown-body :deep(li[data-source-line].preview-hover),
.markdown-body :deep(li[data-source-line].preview-selected),
.markdown-body :deep(li[data-source-line].preview-hover.preview-selected) {
  background-color: transparent;
  width: auto;
  box-shadow: none;
  border-radius: 0;
}

/* inline-block: tight around single-line items, a full rectangle once text wraps. */
.markdown-body :deep(.li-text) {
  display: inline-block;
  vertical-align: top;
}

.markdown-body :deep(li[data-source-line].preview-hover > .li-text),
.markdown-body :deep(li[data-source-line].preview-hover > p),
.markdown-body :deep(li[data-source-line].preview-selected > .li-text),
.markdown-body :deep(li[data-source-line].preview-selected > p) {
  background-color: var(--surface-elevated);
  border-radius: 4px;
  box-shadow:
    -4px 0 0 0 var(--surface-elevated),
    4px 0 0 0 var(--surface-elevated);
  transition:
    background-color 100ms ease,
    box-shadow 100ms ease;
}

.markdown-body :deep(li[data-source-line].preview-hover.preview-selected > .li-text),
.markdown-body :deep(li[data-source-line].preview-hover.preview-selected > p) {
  background-color: var(--surface-overlay);
  box-shadow:
    -5px 0 0 0 var(--surface-overlay),
    5px 0 0 0 var(--surface-overlay);
}

/* Headings with an underline: side shadows' rounded corners arc above the rule, and the underline
   needs full width. Combined-state selector for specificity, as above. */
.markdown-body :deep(h1[data-source-line].preview-hover),
.markdown-body :deep(h1[data-source-line].preview-selected),
.markdown-body :deep(h1[data-source-line].preview-hover.preview-selected),
.markdown-body :deep(h2[data-source-line].preview-hover),
.markdown-body :deep(h2[data-source-line].preview-selected),
.markdown-body :deep(h2[data-source-line].preview-hover.preview-selected),
.markdown-body :deep(h3[data-source-line].preview-hover),
.markdown-body :deep(h3[data-source-line].preview-selected),
.markdown-body :deep(h3[data-source-line].preview-hover.preview-selected),
.markdown-body :deep(h4[data-source-line].preview-hover),
.markdown-body :deep(h4[data-source-line].preview-selected),
.markdown-body :deep(h4[data-source-line].preview-hover.preview-selected) {
  box-shadow: none;
  border-radius: 0;
  width: auto;
}

/* Images: ring around the image itself, not the figure. The figure keeps its full width — fit-content
   would make a percentage-width img (`{w-1/2}`) resolve against itself and shrink on hover.
   Combined-state selector for specificity, as above. */
.markdown-body :deep(figure.image-container.preview-hover),
.markdown-body :deep(figure.image-container.preview-selected),
.markdown-body :deep(figure.image-container.preview-hover.preview-selected) {
  background-color: transparent;
  width: auto;
  box-shadow: none;
}

.markdown-body :deep(figure.image-container.preview-hover img),
.markdown-body :deep(figure.image-container.preview-selected img) {
  box-shadow: 0 0 0 5px var(--surface-elevated);
  transition: box-shadow 100ms ease;
}

.markdown-body :deep(figure.image-container.preview-hover.preview-selected img) {
  box-shadow: 0 0 0 6px var(--surface-overlay);
}

/* Display math: keep the full width so the equation stays centered (fit-content would strand it
   on the left). Combined-state selector for specificity, as above. */
.markdown-body :deep(.katex-block.preview-hover),
.markdown-body :deep(.katex-block.preview-selected),
.markdown-body :deep(.katex-block.preview-hover.preview-selected) {
  width: auto;
  box-shadow: none;
}
</style>
