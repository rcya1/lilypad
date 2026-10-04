<!-- A captured page in a sandboxed iframe with its highlights: painted with the CSS Custom
     Highlight API, a selection toolbar to create them, a note popover, and links to the notes pane.
     Link clicks inside the page are intercepted so the snapshot never navigates. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import {
  useAnnotationsStore,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_KEYS,
  type Highlight,
  type ViewerHighlightRect,
} from '@/stores/annotations'
import { isPdfSelectors, type HighlightColor } from '@/types/database'
import { serializeRange, resolveRange } from '@/lib/textAnchor'
import HighlightToolbar from './HighlightToolbar.vue'
import HighlightPopover from './HighlightPopover.vue'

const props = defineProps<{ documentId: string }>()
const emit = defineEmits<{ 'insert-reference': [] }>()

const filesStore = useFilesStore()
const anno = useAnnotationsStore()

const container = ref<HTMLDivElement | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// Set once the iframe loads; same-origin because it's a blob: URL.
let frameDoc: Document | null = null
let frameWin: (Window & typeof globalThis) | null = null
// Revoked before the next snapshot loads.
let blobUrl: string | null = null
// Rebuilt on every repaint; used for painting and hit-testing.
const resolvedRanges = new Map<string, Range>()

const highlights = computed(() => anno.highlightsFor(props.documentId))

const DEFAULT_COLOR: HighlightColor = 'amber'

const toolbar = ref<{ x: number; y: number } | null>(null)
const popover = ref<{ id: string; x: number; y: number; startEditing: boolean } | null>(null)
const toolbarComp = ref<InstanceType<typeof HighlightToolbar> | null>(null)
const popoverComp = ref<InstanceType<typeof HighlightPopover> | null>(null)
const toolbarEl = () => (toolbarComp.value?.$el as HTMLElement | undefined) ?? null
const popoverEl = () => (popoverComp.value?.$el as HTMLElement | undefined) ?? null

// Captured on mouseup, held until a colour is picked.
let pendingRange: Range | null = null

function revoke() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

/**
 * Loaded as a blob: URL so the frame is same-origin and scriptable. The iframe is sandboxed without
 * allow-scripts, so the page's own JS never runs.
 */
async function load(id: string) {
  loading.value = true
  error.value = null
  closeOverlays()
  revoke()
  const html = await filesStore.downloadSnapshot(id)
  if (html == null) {
    error.value = 'Could not load the captured page.'
    loading.value = false
    return
  }
  blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  // `loading` stays true until onFrameLoad, or a blank frame would flash.
  if (frame.value) frame.value.src = blobUrl
}

async function onFrameLoad() {
  frameDoc = frame.value?.contentDocument ?? null
  frameWin = (frame.value?.contentWindow as (Window & typeof globalThis) | null) ?? null
  if (!frameDoc || !frameWin) {
    loading.value = false
    return
  }

  frameDoc.addEventListener('click', onFrameClick)
  frameDoc.addEventListener('mouseup', onFrameMouseUp)
  frameDoc.addEventListener('mousemove', onFrameMouseMove)
  frameWin.addEventListener('scroll', onFrameScroll, { passive: true })

  await anno.loadForEntry(props.documentId)
  repaint()
  loading.value = false
}

/** Iframe-viewport coordinates → this container's (where the overlays are positioned). */
function toContainer(left: number, top: number): { x: number; y: number } {
  const fr = frame.value?.getBoundingClientRect()
  const cr = container.value?.getBoundingClientRect()
  if (!fr || !cr) return { x: left, y: top }
  return { x: fr.left - cr.left + left, y: fr.top - cr.top + top }
}

/** Nudges an overlay back inside the pane once it has rendered and can be measured. */
async function clampOverlay(
  getEl: () => HTMLElement | null,
  pos: { x: number; y: number } | null,
): Promise<void> {
  await nextTick()
  const cont = container.value?.getBoundingClientRect()
  const r = getEl()?.getBoundingClientRect()
  if (!cont || !r || !pos) return
  const margin = 8
  if (r.left < cont.left + margin) pos.x += cont.left + margin - r.left
  else if (r.right > cont.right - margin) pos.x += cont.right - margin - r.right
  if (r.top < cont.top + margin) pos.y += cont.top + margin - r.top
  else if (r.bottom > cont.bottom - margin) pos.y += cont.bottom - margin - r.bottom
}

/** Exact, since the snapshot never changes. */
function rebuildRanges() {
  resolvedRanges.clear()
  if (!frameDoc?.body) return
  for (const h of highlights.value) {
    if (isPdfSelectors(h.selectors)) continue
    const range = resolveRange(frameDoc.body, h.selectors)
    if (range) resolvedRanges.set(h.id, range)
  }
}

function writeStyles() {
  if (!frameDoc) return
  let styleEl = frameDoc.getElementById('lily-hl-style') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = frameDoc.createElement('style')
    styleEl.id = 'lily-hl-style'
    frameDoc.head.appendChild(styleEl)
  }
  const rules: string[] = []
  for (const key of HIGHLIGHT_COLOR_KEYS) {
    rules.push(`::highlight(lily-${key}){ background-color: ${HIGHLIGHT_COLORS[key].base}; }`)
  }
  // Hover/active use the stronger `active` tone of whichever highlight they point at.
  const hovered = anno.hoveredHighlightId && anno.getById(anno.hoveredHighlightId)
  const active = anno.activeHighlightId && anno.getById(anno.activeHighlightId)
  if (hovered)
    rules.push(
      `::highlight(lily-hover){ background-color: ${HIGHLIGHT_COLORS[hovered.color].active}; }`,
    )
  if (active)
    rules.push(
      `::highlight(lily-active){ background-color: ${HIGHLIGHT_COLORS[active.color].active}; }`,
    )
  styleEl.textContent = rules.join('\n')
}

function repaint() {
  rebuildRanges()
  writeStyles()
  if (!frameWin) return
  // The Custom Highlight API is per-realm — use the iframe's own CSS/Highlight.
  const cssHighlights = frameWin.CSS?.highlights
  const HighlightCtor = (frameWin as unknown as { Highlight?: typeof Highlight }).Highlight
  if (!cssHighlights || !HighlightCtor) return

  cssHighlights.clear()

  for (const key of HIGHLIGHT_COLOR_KEYS) {
    const ranges = highlights.value
      .filter((h) => h.color === key)
      .map((h) => resolvedRanges.get(h.id))
      .filter((r): r is Range => !!r)
    if (ranges.length) cssHighlights.set(`lily-${key}`, new HighlightCtor(...ranges))
  }

  // Emphasis layers win where they overlap the base colours.
  const hoverRange = anno.hoveredHighlightId ? resolvedRanges.get(anno.hoveredHighlightId) : null
  if (hoverRange) {
    const hl = new HighlightCtor(hoverRange)
    hl.priority = 1
    cssHighlights.set('lily-hover', hl)
  }
  const activeRange = anno.activeHighlightId ? resolvedRanges.get(anno.activeHighlightId) : null
  if (activeRange) {
    const hl = new HighlightCtor(activeRange)
    hl.priority = 2
    cssHighlights.set('lily-active', hl)
  }
}

/**
 * Tests the range's glyph boxes, not a caret hit-test: `caretPositionFromPoint` snaps a point past
 * the end of a line to the nearest caret, so the space after a highlight would count.
 */
function highlightAtPoint(x: number, y: number): Highlight | null {
  for (const h of highlights.value) {
    const r = resolvedRanges.get(h.id)
    if (!r) continue
    for (const rect of r.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return h
    }
  }
  return null
}

let hoverRaf = 0

function onFrameMouseMove(e: MouseEvent) {
  if (hoverRaf) return
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0
    const h = highlightAtPoint(e.clientX, e.clientY)
    if (frameDoc) frameDoc.body.style.cursor = h ? 'pointer' : ''
    if ((h?.id ?? null) !== anno.hoveredHighlightId) {
      anno.setHoveredHighlight(h?.id ?? null)
      repaint()
    }
  })
}

function onFrameMouseUp() {
  const sel = frameWin?.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    toolbar.value = null
    return
  }
  const range = sel.getRangeAt(0)
  if (!range.toString().trim()) {
    toolbar.value = null
    return
  }
  pendingRange = range.cloneRange()
  const rect = range.getBoundingClientRect()
  toolbar.value = toContainer(rect.left + rect.width / 2, rect.top)
  clampOverlay(toolbarEl, toolbar.value)
}

function onFrameClick(e: MouseEvent) {
  const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    handleAnchorClick(e, anchor)
    return
  }

  // A highlight: focus it, open its popover and scroll the notes to its reference.
  const h = highlightAtPoint(e.clientX, e.clientY)
  if (h) {
    anno.setActiveHighlight(h.id)
    openPopover(h)
    anno.requestScrollToNote(props.documentId, h.localId)
    repaint()
    return
  }

  if (anno.activeHighlightId) {
    anno.setActiveHighlight(null)
    repaint()
  }
  popover.value = null
}

function onFrameScroll() {
  // The toolbar's anchor is moving, so hide it; keep the popover pinned to its highlight.
  toolbar.value = null
  if (popover.value) {
    const r = resolvedRanges.get(popover.value.id)
    if (r) {
      const rect = r.getBoundingClientRect()
      const pos = toContainer(rect.left, rect.bottom + 6)
      popover.value = { ...popover.value, x: pos.x, y: pos.y }
      clampOverlay(popoverEl, popover.value)
    }
  }
}

/**
 * Captured links resolve to the original site (via the injected <base>), so a click would navigate
 * away from the snapshot. #fragments scroll within it; external links open in a new tab.
 */
function handleAnchorClick(e: MouseEvent, anchor: HTMLAnchorElement) {
  const raw = anchor.getAttribute('href') ?? ''
  if (raw.startsWith('#')) {
    e.preventDefault()
    const id = decodeURIComponent(raw.slice(1))
    if (!id) return
    const target =
      frameDoc?.getElementById(id) ?? frameDoc?.querySelector(`a[name="${CSS.escape(id)}"]`) ?? null
    target?.scrollIntoView({ behavior: 'smooth' })
    return
  }
  e.preventDefault()
  if (/^https?:/i.test(anchor.href)) {
    window.open(anchor.href, '_blank', 'noopener,noreferrer')
  }
}

async function createFromSelection(color: HighlightColor): Promise<Highlight | null> {
  if (!pendingRange || !frameDoc?.body) return null
  const selectors = serializeRange(frameDoc.body, pendingRange)
  if (!selectors) return null
  const h = await anno.createHighlight(props.documentId, selectors, color)
  frameWin?.getSelection()?.removeAllRanges()
  toolbar.value = null
  pendingRange = null
  repaint()
  return h
}

/** Toolbar "add note": highlight in the default colour and open the popover in edit mode. */
async function createAndAnnotate() {
  const h = await createFromSelection(DEFAULT_COLOR)
  if (h) {
    anno.setActiveHighlight(h.id)
    openPopover(h, true)
    repaint()
  }
}

function openPopover(h: Highlight, editing = false) {
  const r = resolvedRanges.get(h.id)
  if (!r) return
  const rect = r.getBoundingClientRect()
  const pos = toContainer(rect.left, rect.bottom + 6)
  popover.value = { id: h.id, x: pos.x, y: pos.y, startEditing: editing }
  clampOverlay(popoverEl, popover.value)
}

function onPopoverClose() {
  popover.value = null
  repaint()
}

function closeOverlays() {
  toolbar.value = null
  popover.value = null
  pendingRange = null
}

// Escape closes the popover, else the toolbar. (While editing a note, the textarea handles it.)
function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (popover.value) {
    popover.value = null
    if (anno.activeHighlightId) {
      anno.setActiveHighlight(null)
      repaint()
    }
  } else if (toolbar.value) {
    toolbar.value = null
  }
}

// A mousedown outside the overlays closes them. Clicks inside the iframe never reach this, so
// clicking a highlight to open its popover isn't undone.
function onWindowMouseDown(e: MouseEvent) {
  const t = e.target as Node
  if (toolbar.value && !toolbarEl()?.contains(t)) toolbar.value = null
  if (popover.value && !popoverEl()?.contains(t)) {
    popover.value = null
    if (anno.activeHighlightId) {
      anno.setActiveHighlight(null)
      repaint()
    }
  }
}

// A notes chip was clicked: scroll to the highlight and focus it.
watch(
  () => anno.scrollToHighlightRequest,
  (id) => {
    if (!id) return
    anno.scrollToHighlightRequest = null
    const h = anno.getById(id)
    if (!h || h.entryId !== props.documentId) return
    anno.setActiveHighlight(id)
    if (!resolvedRanges.has(id)) rebuildRanges()
    const r = resolvedRanges.get(id)
    const el =
      r?.startContainer.nodeType === Node.TEXT_NODE
        ? r.startContainer.parentElement
        : (r?.startContainer as Element | null)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    repaint()
  },
)

watch(highlights, () => repaint(), { deep: true })
watch(
  () => [anno.activeHighlightId, anno.hoveredHighlightId],
  () => repaint(),
)

watch(
  () => props.documentId,
  (id) => {
    closeOverlays()
    nextTick(() => load(id))
  },
  { immediate: true },
)

/**
 * For AnnotatedDocPane's leader line: the highlight's rect in page coordinates, plus the iframe's visible
 * band so the line can be clamped when the highlight is scrolled out of view.
 */
function highlightViewportRect(id: string): ViewerHighlightRect | null {
  if (!frameDoc?.body || !frame.value) return null
  let r = resolvedRanges.get(id)
  if (!r) {
    rebuildRanges()
    r = resolvedRanges.get(id)
  }
  if (!r) return null
  const rr = r.getBoundingClientRect()
  if (rr.width === 0 && rr.height === 0) return null
  const fr = frame.value.getBoundingClientRect()
  return {
    left: fr.left + rr.left,
    top: fr.top + rr.top,
    right: fr.left + rr.right,
    bottom: fr.top + rr.bottom,
    frameTop: fr.top,
    frameBottom: fr.bottom,
    frameLeft: fr.left,
    frameRight: fr.right,
  }
}

defineExpose({ highlightViewportRect })

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('mousedown', onWindowMouseDown)
})

onBeforeUnmount(() => {
  if (hoverRaf) cancelAnimationFrame(hoverRaf)
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('mousedown', onWindowMouseDown)
  revoke()
})
</script>

<template>
  <div ref="container" class="relative h-full w-full bg-white">
    <iframe
      ref="frame"
      title="Captured page"
      class="h-full w-full border-0"
      sandbox="allow-same-origin"
      @load="onFrameLoad"
    />

    <HighlightToolbar
      v-if="toolbar"
      ref="toolbarComp"
      :x="toolbar.x"
      :y="toolbar.y"
      @highlight="createFromSelection"
      @annotate="createAndAnnotate"
    />

    <HighlightPopover
      v-if="popover"
      ref="popoverComp"
      :key="popover.id"
      :highlight-id="popover.id"
      :x="popover.x"
      :y="popover.y"
      :start-editing="popover.startEditing"
      @close="onPopoverClose"
      @insert-reference="emit('insert-reference')"
    />

    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center gap-2 bg-bg text-sm text-text-muted"
    >
      <Loader2 :size="15" class="animate-spin" />
      Loading captured page…
    </div>
    <div
      v-else-if="error"
      class="absolute inset-0 flex items-center justify-center bg-bg text-sm text-text-muted"
    >
      {{ error }}
    </div>
  </div>
</template>
