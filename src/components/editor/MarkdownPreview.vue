<!-- Live HTML preview for the active markdown document with selectable blocks that sync cursor position back to the editor. -->
<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { useWebAnnotationsStore } from '@/stores/webAnnotations'
import { parseMarkdown } from '@/lib/markdown'
import 'katex/dist/katex.min.css'

const props = defineProps<{ documentId: string }>()

const store = useEditorStore()
const filesStore = useFilesStore()
const uiStore = useUiStore()
const anno = useWebAnnotationsStore()
const html = ref('')
const scrollContainer = useTemplateRef<HTMLDivElement>('scrollContainer')

// The source line that the user has clicked/keyboard-navigated to in the preview.
const selectedLine = ref<number | null>(null)
// The source line currently under the mouse cursor (hover highlight).
const hoveredLine = ref<number | null>(null)

// Count words in the raw markdown source, not the rendered HTML, to avoid counting
// HTML tag names and attribute values.
const wordCount = computed(() => {
  const content = store.openDocuments.get(props.documentId)?.content ?? ''
  return content.trim().split(/\s+/).filter(Boolean).length
})

let debounceTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Parse the markdown and update the rendered HTML.
 * The image URL resolver is injected so the renderer can resolve `img:<id>` references
 * to public Supabase storage URLs without importing the files store directly.
 */
function render(content: string) {
  html.value = parseMarkdown(content, (entryId) => filesStore.getImageUrl(entryId))
}

onMounted(() => {
  const doc = store.openDocuments.get(props.documentId)
  render(doc?.content ?? '')
  const saved = store.previewScrollTop.get(props.documentId)
  if (saved) {
    // nextTick ensures the rendered HTML has been inserted into the DOM before
    // we set scrollTop; without it the container height may still be 0.
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop = saved
      }
    })
  }
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  // Persist scroll position so it's restored when the user returns to this document.
  if (scrollContainer.value) {
    store.previewScrollTop.set(props.documentId, scrollContainer.value.scrollTop)
  }
})

// 50 ms debounce: coalesces re-renders during fast typing bursts while staying
// imperceptible. (Anything under a keystroke interval re-renders every keypress.)
watch(
  () => store.openDocuments.get(props.documentId)?.content,
  (content) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => render(content ?? ''), 50)
  },
)

// --- Selectable block helpers ---

/**
 * Return all annotated block elements in document order, excluding ul/ol containers.
 * The markdown renderer annotates every block with `data-source-line`; list containers
 * (ul/ol) are skipped here because their children (li) already carry their own
 * source-line annotations and are the meaningful selection targets.
 */
function getSelectableElements(): HTMLElement[] {
  const container = scrollContainer.value?.querySelector('.markdown-body')
  if (!container) return []
  return (Array.from(container.querySelectorAll('[data-source-line]')) as HTMLElement[]).filter(
    (el) => {
      const tag = el.tagName.toLowerCase()
      // ul/ol that have annotated children are container elements, not content elements.
      if ((tag === 'ul' || tag === 'ol') && el.querySelector('[data-source-line]')) return false
      return true
    },
  )
}

function getSourceLine(el: HTMLElement): number {
  return parseInt(el.getAttribute('data-source-line') || '', 10)
}

// --- Mouse handlers ---

/**
 * Walk up the DOM from `el` to find the nearest block with a source-line annotation,
 * skipping ul/ol containers (clicking in the gap between list items should not
 * highlight a container with no direct visible content).
 */
function findSelectableSourceLine(el: HTMLElement): HTMLElement | null {
  const target = el.closest?.('[data-source-line]') as HTMLElement | null
  if (!target) return null
  const tag = target.tagName.toLowerCase()
  if ((tag === 'ul' || tag === 'ol') && target.querySelector('[data-source-line]')) return null
  return target
}

function onMouseOver(event: MouseEvent) {
  // Highlight-reference chips: mirror hover state to the captured page.
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

/**
 * Select the clicked block and synchronise the editor cursor to that source line.
 * Clicking on empty space (no selectable block) clears the selection and removes
 * the editor line highlight.
 */
function onClick(event: MouseEvent) {
  // Clicking a highlight-reference chip scrolls the captured page to that highlight.
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
  // Propagate the cursor line to the store so the editor can scroll to and highlight it.
  store.setPreviewCursor(props.documentId, line)
  store.setFocusedPane('preview')
  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  // Focus the container so keyboard shortcuts (j/k/y/Escape) work immediately after click.
  scrollContainer.value?.focus()
}

// --- Keyboard handler ---

/**
 * Vim-inspired keyboard navigation while the preview has focus:
 *   j / ↓   — move selection down one block
 *   k / ↑   — move selection up one block
 *   y       — copy the selected block's text content to the clipboard
 *   Escape  — return focus to the editor
 */
function onKeyDown(event: KeyboardEvent) {
  const key = event.key

  if (key === 'j' || key === 'ArrowDown' || key === 'k' || key === 'ArrowUp') {
    event.preventDefault()
    const elements = getSelectableElements()
    if (elements.length === 0) return

    const direction = key === 'j' || key === 'ArrowDown' ? 1 : -1

    if (selectedLine.value == null) {
      // Nothing selected yet — jump to the first or last element.
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

// --- Focus management ---

function onFocus() {
  store.setFocusedPane('preview')
}

/**
 * Clear selection state when the preview loses focus so stale highlights don't persist
 * after the user switches back to the editor.
 */
function onBlur() {
  selectedLine.value = null
  hoveredLine.value = null
  store.requestClearEditorHighlight(props.documentId)
}

// When the editor regains focus (e.g. user clicks in the CM pane), remove focus from the
// preview container so its keyboard shortcuts don't interfere with editing.
watch(
  () => store.focusedPane,
  (pane) => {
    if (pane === 'editor') {
      scrollContainer.value?.blur()
    }
  },
)

// --- Highlight class management ---

/**
 * Find the selectable element for a given source line, skipping ul/ol container elements.
 * Multiple elements can share the same source line (e.g. a li and its nested ul);
 * we return the first non-container match.
 */
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

// flush: 'sync' is intentional: we need the DOM class updates to happen in the same
// tick as the ref change so the highlight is never one frame behind the cursor.
watch([hoveredLine, selectedLine], updateHighlights, { flush: 'sync' })

// After the HTML re-renders, re-apply highlights (DOM was replaced) and re-sync the
// editor cursor in case the block layout changed (e.g. lines were added/deleted).
watch(html, () =>
  nextTick(() => {
    updateHighlights()
    syncFromEditorCursor()
  }),
)

// --- Sync from store ---

// The editor store writes previewCursorLine when the user clicks a block in the preview;
// this watcher keeps selectedLine in sync when the store value changes from elsewhere.
watch(
  () => store.previewCursorLine.get(props.documentId),
  (line) => {
    if (line != null) selectedLine.value = line
  },
)

/**
 * When the editor cursor moves, find and highlight the preview block whose source line
 * is the largest value ≤ the cursor line (i.e. the block the cursor is "inside").
 * Only runs while the editor pane has focus to avoid fighting with click-based selection.
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

// --- Highlight-reference chips (web documents) ---

/** Add the `lily-ref-active` class to chips whose highlight is active or hovered on the page side. */
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
// Re-apply chip classes after every re-render (the DOM was replaced).
watch(html, () => nextTick(updateRefChips))

// A highlight was clicked on the page → scroll to its first reference chip here and flash it.
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

/* Hover or selected — same light tone */
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

/* Hover over the selected element — darker accent */
.markdown-body :deep([data-source-line].preview-hover.preview-selected) {
  background-color: var(--surface-overlay);
  box-shadow:
    -5px 0 0 0 var(--surface-overlay),
    5px 0 0 0 var(--surface-overlay);
}

/* For list items: don't highlight the full li bounding box (which includes nested lists).
   Clear the general rule's background/width and delegate to the text span or paragraph.
   All three state rules are needed: the general combined-state rule (.preview-hover.preview-selected)
   has specificity (0,4,0) which beats a single-class li rule (0,3,1), so it must be
   explicitly overridden with the combined-class selector to reach (0,4,1). */
.markdown-body :deep(li[data-source-line].preview-hover),
.markdown-body :deep(li[data-source-line].preview-selected),
.markdown-body :deep(li[data-source-line].preview-hover.preview-selected) {
  background-color: transparent;
  width: auto;
  box-shadow: none;
  border-radius: 0;
}

/* inline-block shrinks to text width when content fits on one line (single-line items
   stay tight), but expands to the full available width when text wraps (multi-line items
   get a rectangular block highlight). Also creates an internal BFC so inline code
   element heights are accounted for naturally — no padding-block hack needed. */
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

/* For headings with border-bottom underlines: the rounded box-shadow corners arc
   above the straight underline, creating a raised-corner artifact. Also restore
   full width so the underline spans the container.
   The combined-state selector is required because the general .preview-hover.preview-selected
   rule has specificity (0,5,0) which beats the single-class heading rule (0,4,1) and
   re-applies the side box-shadows. Adding the element+combined selector reaches (0,5,1). */
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
  border-bottom: 1px solid var(--text-primary);
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
  margin: 0.45em 0;
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

.markdown-body :deep(.image-container) {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 1.5em auto;
}

.markdown-body :deep(.image-container img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

.markdown-body :deep(.image-container figcaption) {
  margin-top: 0.5em;
  font-size: 0.85em;
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
}

/* Image containers — ring on the image, background covers the whole figure */
.markdown-body :deep(figure.image-container.preview-hover img),
.markdown-body :deep(figure.image-container.preview-selected img) {
  box-shadow: 0 0 0 5px var(--surface-elevated);
  transition: box-shadow 100ms ease;
}

.markdown-body :deep(figure.image-container.preview-hover.preview-selected img) {
  box-shadow: 0 0 0 6px var(--surface-overlay);
}

/* KaTeX display blocks */
.markdown-body :deep(.katex-display) {
  margin: 1em 0;
}

/* Display-math blocks keep full width when highlighted so the equation stays centered.
   The general rule sets `width: fit-content` + side box-shadows, which would shrink the box
   to the equation's width and strand it against the left edge. Override to a full-width band.
   The combined-state selector is required because .preview-hover.preview-selected (0,5,0)
   outranks a single-class .katex-block rule (0,4,1); the element+combined form reaches (0,5,1). */
.markdown-body :deep(.katex-block.preview-hover),
.markdown-body :deep(.katex-block.preview-selected),
.markdown-body :deep(.katex-block.preview-hover.preview-selected) {
  width: auto;
  box-shadow: none;
}

/* LaTeX error diagnostics */
.markdown-body :deep(.katex-error-msg) {
  margin-top: 0.5em;
  padding: 0.4em 0.7em;
  border-left: 3px solid #c0392b;
  border-radius: 4px;
  background: rgba(192, 57, 43, 0.08);
  color: #c0392b;
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  line-height: 1.4;
  text-align: left;
  white-space: pre-wrap;
  overflow-x: auto;
}

.markdown-body :deep(.katex-error-inline) {
  color: #c0392b;
  background: rgba(192, 57, 43, 0.08);
  border-radius: 3px;
  padding: 0 0.2em;
  text-decoration: underline wavy #c0392b;
  text-underline-offset: 2px;
  cursor: help;
}

/* Highlight-reference chips (web documents): [text](lily:hl-3) */
.markdown-body :deep(.lily-ref) {
  display: inline;
  cursor: pointer;
  color: var(--text-primary);
  background: var(--accent-subtle);
  border-radius: 4px;
  padding: 0.02em 0.3em;
  text-decoration: none;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: background-color 100ms ease;
}
.markdown-body :deep(.lily-ref:hover),
.markdown-body :deep(.lily-ref.lily-ref-active) {
  background: color-mix(in srgb, var(--accent) 30%, var(--bg));
}
.markdown-body :deep(.lily-ref.lily-ref-flash) {
  animation: lily-ref-flash 1.2s ease;
}
@keyframes lily-ref-flash {
  0%,
  40% {
    background: color-mix(in srgb, var(--accent) 30%, var(--bg));
  }
  100% {
    background: var(--accent-subtle);
  }
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
