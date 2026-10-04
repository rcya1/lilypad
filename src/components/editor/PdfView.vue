<!-- A PDF as one continuous vertical scroll (pdf.js PDFViewer renders pages lazily as they near the
     viewport), with highlights painted as divs over each page, a selection toolbar to create them, a
     note popover, and links to the notes pane. -->
<script lang="ts">
/** Where each PDF was left, so switching tabs (which remounts this) returns to the same spot. */
const lastLocation = new Map<
  string,
  { pageNumber: number; top: number; left: number; scale: number | string }
>()

/** The last few PDFs' bytes, so flipping between tabs doesn't re-download them. */
const bytesCache = new Map<string, ArrayBuffer>()
const BYTES_CACHE_SIZE = 3

function cacheBytes(id: string, bytes: ArrayBuffer) {
  bytesCache.delete(id)
  bytesCache.set(id, bytes)
  while (bytesCache.size > BYTES_CACHE_SIZE) bytesCache.delete(bytesCache.keys().next().value!)
}
</script>

<script setup lang="ts">
import 'pdfjs-dist/web/pdf_viewer.css'
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from 'vue'
import { Loader2, ZoomIn, ZoomOut, MoveHorizontal } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import {
  useAnnotationsStore,
  HIGHLIGHT_COLORS,
  type Highlight,
  type ViewerHighlightRect,
} from '@/stores/annotations'
import {
  isPdfSelectors,
  type HighlightColor,
  type PdfHighlightSelectors,
  type PdfRect,
} from '@/types/database'
import { loadPdfjs, openPdf, type PDFDocumentProxy } from '@/lib/pdfjs'
import { mergeLineBoxes, normalizeQuote, type Box } from '@/lib/pdfAnchor'
import HighlightToolbar from './HighlightToolbar.vue'
import HighlightPopover from './HighlightPopover.vue'

const props = defineProps<{ documentId: string }>()
const emit = defineEmits<{ 'insert-reference': [] }>()

const filesStore = useFilesStore()
const anno = useAnnotationsStore()

type ViewerModule = Awaited<ReturnType<typeof loadPdfjs>>['viewer']
type PDFViewer = InstanceType<ViewerModule['PDFViewer']>
type EventBus = InstanceType<ViewerModule['EventBus']>
type PDFLinkService = InstanceType<ViewerModule['PDFLinkService']>

/** The parts of pdf.js's PageViewport used here. */
interface Viewport {
  width: number
  height: number
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}
interface PageView {
  div: HTMLDivElement
  viewport: Viewport
}

// Overlays are positioned in `body`'s coordinates; `scroller` is pdf.js's (absolute) container.
const body = useTemplateRef<HTMLDivElement>('body')
const scroller = useTemplateRef<HTMLDivElement>('scroller')
const viewerEl = useTemplateRef<HTMLDivElement>('viewerEl')

const loading = ref(true)
const error = ref<string | null>(null)
const pageCount = ref(0)
const currentPage = ref(1)
const pageInput = ref('1')
const scalePct = ref(100)
const fitWidth = ref(true)

let pdfViewer: PDFViewer | null = null
let eventBus: EventBus | null = null
let linkService: PDFLinkService | null = null
let pdfDoc: PDFDocumentProxy | null = null
// Bumped per load, so a slow load that finishes after a switch is dropped.
let loadToken = 0

const highlights = computed(() =>
  anno.highlightsFor(props.documentId).filter((h) => isPdfSelectors(h.selectors)),
)

const DEFAULT_COLOR: HighlightColor = 'amber'
const MIN_SCALE = 0.25
const MAX_SCALE = 5

const toolbar = ref<{ x: number; y: number } | null>(null)
const popover = ref<{ id: string; x: number; y: number; startEditing: boolean } | null>(null)
const toolbarComp = ref<InstanceType<typeof HighlightToolbar> | null>(null)
const popoverComp = ref<InstanceType<typeof HighlightPopover> | null>(null)
const toolbarEl = () => (toolbarComp.value?.$el as HTMLElement | undefined) ?? null
const popoverEl = () => (popoverComp.value?.$el as HTMLElement | undefined) ?? null

// Computed on mouseup (while the selection still exists), held until a colour is picked.
let pendingSelectors: PdfHighlightSelectors | null = null

function getPageView(pageIndex: number): PageView | null {
  return (pdfViewer?.getPageView(pageIndex) as PageView | undefined) ?? null
}

// --- Loading -------------------------------------------------------------------------------------

async function setUpViewer() {
  const { viewer } = await loadPdfjs()
  if (!scroller.value || !viewerEl.value) return
  eventBus = new viewer.EventBus()
  linkService = new viewer.PDFLinkService({
    eventBus,
    externalLinkTarget: viewer.LinkTarget.BLANK,
    externalLinkRel: 'noopener noreferrer nofollow',
  })
  pdfViewer = new viewer.PDFViewer({
    container: scroller.value,
    viewer: viewerEl.value,
    eventBus,
    linkService,
    removePageBorders: false,
  })
  linkService.setViewer(pdfViewer)

  eventBus.on('pagesinit', onPagesInit)
  eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
    currentPage.value = pageNumber
    pageInput.value = String(pageNumber)
  })
  eventBus.on('scalechanging', ({ scale }: { scale: number }) => {
    scalePct.value = Math.round(scale * 100)
  })
  eventBus.on('pagerendered', ({ pageNumber }: { pageNumber: number }) => {
    paintPage(pageNumber - 1)
  })
  eventBus.on(
    'updateviewarea',
    ({
      location,
    }: {
      location: { pageNumber: number; top: number; left: number; scale: number | string }
    }) => {
      if (!location) return
      const { pageNumber, top, left, scale } = location
      lastLocation.set(props.documentId, { pageNumber, top, left, scale })
    },
  )
}

async function load(id: string) {
  const token = ++loadToken
  loading.value = true
  error.value = null
  closeOverlays()

  if (!pdfViewer) await setUpViewer()
  if (!pdfViewer || token !== loadToken) return

  let bytes = bytesCache.get(id) ?? null
  if (!bytes) {
    bytes = await filesStore.downloadPdf(id)
    if (bytes) cacheBytes(id, bytes)
  }
  if (token !== loadToken) return
  if (!bytes) {
    error.value = 'Could not load the PDF.'
    loading.value = false
    return
  }

  try {
    const doc = await openPdf(bytes)
    if (token !== loadToken) {
      void doc.loadingTask.destroy()
      return
    }
    const old = pdfDoc
    pdfDoc = doc
    pageCount.value = doc.numPages
    pdfViewer.setDocument(doc)
    linkService?.setDocument(doc)
    if (old) void old.loadingTask.destroy()
  } catch (err) {
    console.error('Opening PDF failed:', err)
    error.value = 'This file could not be opened as a PDF.'
    loading.value = false
    return
  }

  await anno.loadForEntry(id)
}

/** Restores the last position, else fits the width. */
function onPagesInit() {
  if (!pdfViewer) return
  const loc = lastLocation.get(props.documentId)
  if (loc) {
    if (typeof loc.scale === 'number') {
      fitWidth.value = false
      pdfViewer.currentScale = loc.scale / 100
    } else {
      fitWidth.value = loc.scale === 'page-width'
      pdfViewer.currentScaleValue = loc.scale
    }
    pdfViewer.scrollPageIntoView({
      pageNumber: loc.pageNumber,
      destArray: [null, { name: 'XYZ' }, loc.left, loc.top, null],
      allowNegativeOffset: true,
    })
  } else {
    fitWidth.value = true
    pdfViewer.currentScaleValue = 'page-width'
  }
  paintAll()
  loading.value = false
}

// --- Toolbar: pages and zoom ---------------------------------------------------------------------

function goToPage() {
  const n = parseInt(pageInput.value, 10)
  if (!pdfViewer || !Number.isFinite(n)) {
    pageInput.value = String(currentPage.value)
    return
  }
  pdfViewer.currentPageNumber = Math.min(Math.max(n, 1), pageCount.value)
  pageInput.value = String(pdfViewer.currentPageNumber)
}

function zoom(steps: number) {
  if (!pdfViewer) return
  fitWidth.value = false
  const target = pdfViewer.currentScale * 1.1 ** steps
  pdfViewer.currentScale = Math.min(Math.max(target, MIN_SCALE), MAX_SCALE)
}

function setFitWidth() {
  if (!pdfViewer) return
  fitWidth.value = true
  pdfViewer.currentScaleValue = 'page-width'
}

/** Ctrl/⌘+wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms around the pointer. */
function onWheel(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey) || !pdfViewer) return
  e.preventDefault()
  fitWidth.value = false
  const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002))
  const target = Math.min(Math.max(pdfViewer.currentScale * factor, MIN_SCALE), MAX_SCALE)
  pdfViewer.updateScale({
    scaleFactor: target / pdfViewer.currentScale,
    origin: [e.clientX, e.clientY],
    drawingDelay: 300,
  })
}

// The pane width changes with the divider and the window; keep "fit width" fitted.
let resizeObserver: ResizeObserver | null = null
let resizeRaf = 0
function onResize() {
  if (resizeRaf) return
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0
    if (fitWidth.value && pdfViewer?.pdfDocument) pdfViewer.currentScaleValue = 'page-width'
    repositionPopover()
  })
}

// --- Painting ------------------------------------------------------------------------------------

function colorFor(h: Highlight): string {
  const emphasised = h.id === anno.hoveredHighlightId || h.id === anno.activeHighlightId
  return HIGHLIGHT_COLORS[h.color][emphasised ? 'active' : 'base']
}

/**
 * One div per stored rect, positioned in percentages of the page so CSS-only zooming (before
 * pdf.js re-renders) keeps them aligned. pdf.js clears the layer whenever it re-renders a page, and
 * `pagerendered` calls this again.
 */
function paintPage(pageIndex: number) {
  const pv = getPageView(pageIndex)
  if (!pv?.div) return
  let layer = pv.div.querySelector<HTMLDivElement>(':scope > .lily-hl-layer')
  const onPage = highlights.value.filter((h) =>
    (h.selectors as PdfHighlightSelectors).pages.some((p) => p.page === pageIndex),
  )
  if (!onPage.length) {
    layer?.remove()
    return
  }
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'lily-hl-layer'
    pv.div.appendChild(layer)
  }
  const { viewport } = pv
  const frag = document.createDocumentFragment()
  for (const h of onPage) {
    const sel = h.selectors as PdfHighlightSelectors
    for (const p of sel.pages) {
      if (p.page !== pageIndex) continue
      for (const rect of p.rects) {
        const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number]
        const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number]
        const el = document.createElement('div')
        el.className = 'lily-hl'
        el.dataset.hlId = h.id
        el.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`
        el.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`
        el.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`
        el.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`
        el.style.backgroundColor = colorFor(h)
        frag.appendChild(el)
      }
    }
  }
  layer.replaceChildren(frag)
}

function paintAll() {
  if (!pdfViewer) return
  for (let i = 0; i < pdfViewer.pagesCount; i++) paintPage(i)
}

/** Hover/active only change colours, so restyle the existing divs. */
function updateEmphasis() {
  viewerEl.value?.querySelectorAll<HTMLElement>('.lily-hl').forEach((el) => {
    const h = anno.getById(el.dataset.hlId ?? '')
    if (h) el.style.backgroundColor = colorFor(h)
  })
}

function highlightEls(id: string): HTMLElement[] {
  return Array.from(
    viewerEl.value?.querySelectorAll<HTMLElement>(`.lily-hl[data-hl-id="${CSS.escape(id)}"]`) ?? [],
  )
}

// --- Hit-testing ---------------------------------------------------------------------------------

/** The layer is pointer-events: none (so text stays selectable), so test the point by hand. */
function highlightAtPoint(target: EventTarget | null, x: number, y: number): Highlight | null {
  const page = (target as Element | null)?.closest?.('.page')
  const layer = page?.querySelector(':scope > .lily-hl-layer')
  if (!layer) return null
  for (const el of layer.children) {
    const r = el.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return anno.getById((el as HTMLElement).dataset.hlId ?? '') ?? null
    }
  }
  return null
}

let hoverRaf = 0
let lastMove: MouseEvent | null = null

function onMouseMove(e: MouseEvent) {
  lastMove = e
  if (hoverRaf) return
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0
    const ev = lastMove
    if (!ev) return
    const h = highlightAtPoint(ev.target, ev.clientX, ev.clientY)
    viewerEl.value?.classList.toggle('over-highlight', !!h)
    if ((h?.id ?? null) !== anno.hoveredHighlightId) anno.setHoveredHighlight(h?.id ?? null)
  })
}

function onMouseLeave() {
  viewerEl.value?.classList.remove('over-highlight')
  if (anno.hoveredHighlightId && highlights.value.some((h) => h.id === anno.hoveredHighlightId)) {
    anno.setHoveredHighlight(null)
  }
}

// --- Selection → highlight -----------------------------------------------------------------------

/** Client coordinates → `body`'s (where the overlays are positioned). */
function toBody(left: number, top: number): { x: number; y: number } {
  const br = body.value?.getBoundingClientRect()
  return br ? { x: left - br.left, y: top - br.top } : { x: left, y: top }
}

/** Nudges an overlay back inside the pane once it has rendered and can be measured. */
async function clampOverlay(
  getEl: () => HTMLElement | null,
  pos: { x: number; y: number } | null,
): Promise<void> {
  await nextTick()
  const cont = body.value?.getBoundingClientRect()
  const r = getEl()?.getBoundingClientRect()
  if (!cont || !r || !pos) return
  const margin = 8
  if (r.left < cont.left + margin) pos.x += cont.left + margin - r.left
  else if (r.right > cont.right - margin) pos.x += cont.right - margin - r.right
  if (r.top < cont.top + margin) pos.y += cont.top + margin - r.top
  else if (r.bottom > cont.bottom - margin) pos.y += cont.bottom - margin - r.bottom
}

const CONTEXT_LEN = 40

/**
 * Rects come from the selected text nodes only: the range's own client rects would include whole
 * elements it spans (pdf.js's full-page `endOfContent` div among them).
 */
function selectionToSelectors(
  range: Range,
  selectedText: string,
): { selectors: PdfHighlightSelectors; firstBox: Box } | null {
  const exact = normalizeQuote(selectedText)
  if (!exact) return null

  const rootNode = range.commonAncestorContainer
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  if (rootNode.nodeType === Node.TEXT_NODE) nodes.push(rootNode as Text)
  else {
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (range.intersectsNode(n) && n.parentElement?.closest('.textLayer')) nodes.push(n as Text)
    }
  }

  const byPage = new Map<
    number,
    { textLayer: Element; boxes: Box[]; first: Text; offset: number; length: number }
  >()
  for (const node of nodes) {
    const textLayer = node.parentElement?.closest('.textLayer')
    const page = textLayer?.closest<HTMLElement>('.page')
    const pageNumber = Number(page?.dataset.pageNumber)
    if (!textLayer || !Number.isFinite(pageNumber)) continue

    const sub = document.createRange()
    sub.selectNodeContents(node)
    if (node === range.startContainer) sub.setStart(node, range.startOffset)
    if (node === range.endContainer) sub.setEnd(node, range.endOffset)
    if (sub.collapsed) continue

    let entry = byPage.get(pageNumber - 1)
    if (!entry) {
      entry = { textLayer, boxes: [], first: node, offset: sub.startOffset, length: 0 }
      byPage.set(pageNumber - 1, entry)
    }
    entry.length += sub.toString().length
    for (const r of sub.getClientRects()) {
      entry.boxes.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
  }
  if (!byPage.size) return null

  const pages: PdfHighlightSelectors['pages'] = []
  let firstBox: Box | null = null
  for (const [pageIndex, entry] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const pv = getPageView(pageIndex)
    if (!pv) continue
    const ref = entry.textLayer.getBoundingClientRect()
    const merged = mergeLineBoxes(entry.boxes)
    if (!merged.length) continue
    firstBox ??= merged[0]!
    const rects = merged.map((b): PdfRect => {
      const [ax, ay] = pv.viewport.convertToPdfPoint(b.left - ref.left, b.top - ref.top) as [
        number,
        number,
      ]
      const [bx, by] = pv.viewport.convertToPdfPoint(b.right - ref.left, b.bottom - ref.top) as [
        number,
        number,
      ]
      const r2 = (v: number) => Math.round(v * 100) / 100
      return [
        r2(Math.min(ax, bx)),
        r2(Math.min(ay, by)),
        r2(Math.max(ax, bx)),
        r2(Math.max(ay, by)),
      ]
    })
    pages.push({ page: pageIndex, rects })
  }
  if (!pages.length || !firstBox) return null

  // Offsets into the start page's text, counted like Range.toString().
  const startPage = pages[0]!.page
  const start = byPage.get(startPage)!
  const pre = document.createRange()
  pre.selectNodeContents(start.textLayer)
  pre.setEnd(start.first, start.offset)
  const startOffset = pre.toString().length
  const endOffset = startOffset + start.length
  const full = start.textLayer.textContent ?? ''

  return {
    selectors: {
      kind: 'pdf-text',
      pages,
      quote: {
        exact,
        prefix: full.slice(Math.max(0, startOffset - CONTEXT_LEN), startOffset),
        suffix: full.slice(endOffset, endOffset + CONTEXT_LEN),
      },
      position: { page: startPage, start: startOffset, end: endOffset },
    },
    firstBox,
  }
}

function onMouseUp(e: MouseEvent) {
  if (e.button !== 0) return
  // After the browser has finalised the selection.
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      toolbar.value = null
      pendingSelectors = null
      return
    }
    const range = sel.getRangeAt(0)
    if (!viewerEl.value?.contains(range.commonAncestorContainer)) return
    const result = selectionToSelectors(range, sel.toString())
    if (!result) {
      toolbar.value = null
      pendingSelectors = null
      return
    }
    pendingSelectors = result.selectors
    const { firstBox } = result
    toolbar.value = toBody((firstBox.left + firstBox.right) / 2, firstBox.top)
    clampOverlay(toolbarEl, toolbar.value)
  })
}

function onClick(e: MouseEvent) {
  if ((e.target as Element | null)?.closest?.('a[href], .annotationLayer section')) return
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return

  const h = highlightAtPoint(e.target, e.clientX, e.clientY)
  if (h) {
    anno.setActiveHighlight(h.id)
    openPopover(h)
    anno.requestScrollToNote(props.documentId, h.localId)
    return
  }
  if (anno.activeHighlightId) anno.setActiveHighlight(null)
  popover.value = null
}

async function createFromSelection(color: HighlightColor): Promise<Highlight | null> {
  if (!pendingSelectors) return null
  const h = await anno.createHighlight(props.documentId, pendingSelectors, color)
  window.getSelection()?.removeAllRanges()
  toolbar.value = null
  pendingSelectors = null
  return h
}

/** Toolbar "add note": highlight in the default colour and open the popover in edit mode. */
async function createAndAnnotate() {
  const h = await createFromSelection(DEFAULT_COLOR)
  if (h) {
    anno.setActiveHighlight(h.id)
    await nextTick()
    openPopover(h, true)
  }
}

// --- Popover -------------------------------------------------------------------------------------

/** Below the highlight's last line (its first page), or null if it isn't laid out. */
function popoverAnchor(id: string): { x: number; y: number } | null {
  const els = highlightEls(id)
  if (!els.length) return null
  const rects = els.map((el) => el.getBoundingClientRect())
  const left = Math.min(...rects.map((r) => r.left))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return toBody(left, bottom + 6)
}

function openPopover(h: Highlight, startEditing = false) {
  const pos = popoverAnchor(h.id)
  if (!pos) return
  popover.value = { id: h.id, x: pos.x, y: pos.y, startEditing }
  clampOverlay(popoverEl, popover.value)
}

function repositionPopover() {
  if (!popover.value) return
  const pos = popoverAnchor(popover.value.id)
  if (!pos) return
  popover.value = { ...popover.value, x: pos.x, y: pos.y }
  clampOverlay(popoverEl, popover.value)
}

function onPopoverClose() {
  popover.value = null
}

function onScroll() {
  // The toolbar's anchor is moving, so hide it; keep the popover pinned to its highlight.
  toolbar.value = null
  repositionPopover()
}

function closeOverlays() {
  toolbar.value = null
  popover.value = null
  pendingSelectors = null
}

// Escape closes the popover, else the toolbar. (While editing a note, the textarea handles it.)
function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (popover.value) {
    popover.value = null
    if (anno.activeHighlightId) anno.setActiveHighlight(null)
  } else if (toolbar.value) {
    toolbar.value = null
  }
}

// A mousedown outside the overlays closes them (a click on a highlight then reopens its popover).
function onWindowMouseDown(e: MouseEvent) {
  const t = e.target as Node
  if (toolbar.value && !toolbarEl()?.contains(t)) toolbar.value = null
  if (popover.value && !popoverEl()?.contains(t)) {
    popover.value = null
    if (anno.activeHighlightId) anno.setActiveHighlight(null)
  }
}

// --- Cross-pane ----------------------------------------------------------------------------------

// A notes chip was clicked: scroll to the highlight (its page may never have rendered) and focus it.
watch(
  () => anno.scrollToHighlightRequest,
  (id) => {
    if (!id) return
    const h = anno.getById(id)
    if (!h || h.entryId !== props.documentId || !isPdfSelectors(h.selectors)) return
    anno.scrollToHighlightRequest = null
    const first = h.selectors.pages[0]
    const rect = first?.rects[0]
    if (!pdfViewer || !first || !rect) return
    anno.setActiveHighlight(id)
    pdfViewer.scrollPageIntoView({
      pageNumber: first.page + 1,
      destArray: [null, { name: 'XYZ' }, null, rect[3], null],
      allowNegativeOffset: true,
    })
    // Leave some context above the highlight rather than pinning it to the top edge.
    if (scroller.value) scroller.value.scrollTop -= scroller.value.clientHeight / 3
  },
)

/**
 * For the leader line: the highlight's rect on screen, plus the viewer's visible band so the line
 * can be clamped when the highlight is scrolled out of view.
 */
function highlightViewportRect(id: string): ViewerHighlightRect | null {
  const els = highlightEls(id)
  const band = scroller.value?.getBoundingClientRect()
  if (!els.length || !band) return null
  // The first page's rects only, so a highlight across a page break points at where it starts.
  const firstPage = els[0]!.closest('.page')
  const rects = els
    .filter((el) => el.closest('.page') === firstPage)
    .map((el) => el.getBoundingClientRect())
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
    frameTop: band.top,
    frameBottom: band.bottom,
    frameLeft: band.left,
    frameRight: band.right,
  }
}

defineExpose({ highlightViewportRect })

watch(highlights, () => paintAll(), { deep: true })
watch(
  () => [anno.activeHighlightId, anno.hoveredHighlightId],
  () => updateEmphasis(),
)

watch(
  () => props.documentId,
  (id) => nextTick(() => load(id)),
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDown)
  window.addEventListener('mousedown', onWindowMouseDown)
  scroller.value?.addEventListener('wheel', onWheel, { passive: false })
  resizeObserver = new ResizeObserver(onResize)
  if (scroller.value) resizeObserver.observe(scroller.value)
})

onBeforeUnmount(() => {
  loadToken++
  if (hoverRaf) cancelAnimationFrame(hoverRaf)
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onWindowKeyDown)
  window.removeEventListener('mousedown', onWindowMouseDown)
  scroller.value?.removeEventListener('wheel', onWheel)
  pdfViewer?.cleanup()
  if (pdfDoc) void pdfDoc.loadingTask.destroy()
  pdfViewer = null
  pdfDoc = null
  eventBus = null
  linkService = null
})
</script>

<template>
  <div class="flex h-full w-full flex-col bg-surface">
    <div
      class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-surface px-2 font-ui text-xs text-text-secondary"
    >
      <div class="flex items-center gap-1">
        <span>Page</span>
        <input
          v-model="pageInput"
          class="h-6 w-10 rounded border border-border-subtle bg-bg px-1 text-center text-text-primary outline-none focus:border-accent"
          inputmode="numeric"
          aria-label="Page number"
          :disabled="!pageCount"
          @keydown.enter="goToPage"
          @blur="goToPage"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <span class="text-text-muted">/ {{ pageCount || '–' }}</span>
      </div>

      <div class="flex items-center gap-0.5">
        <button
          class="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-elevated hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom out (Ctrl+scroll)"
          :disabled="!pageCount"
          @click="zoom(-1)"
        >
          <ZoomOut :size="16" />
        </button>
        <span class="w-11 text-center tabular-nums">{{ scalePct }}%</span>
        <button
          class="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface-elevated hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom in (Ctrl+scroll)"
          :disabled="!pageCount"
          @click="zoom(1)"
        >
          <ZoomIn :size="16" />
        </button>
        <button
          class="ml-1 flex h-6 w-6 items-center justify-center rounded hover:bg-surface-elevated cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          :class="fitWidth ? 'text-accent' : 'text-text-muted hover:text-text-primary'"
          title="Fit width"
          :disabled="!pageCount"
          @click="setFitWidth"
        >
          <MoveHorizontal :size="16" />
        </button>
      </div>
    </div>

    <div ref="body" class="relative min-h-0 flex-1">
      <div
        ref="scroller"
        class="pdf-scroller absolute inset-0 overflow-auto"
        @scroll.passive="onScroll"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
        @mouseup="onMouseUp"
        @click="onClick"
      >
        <div ref="viewerEl" class="pdfViewer" />
      </div>

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
        Loading PDF…
      </div>
      <div
        v-else-if="error"
        class="absolute inset-0 flex items-center justify-center bg-bg text-sm text-text-muted"
      >
        {{ error }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Grey gutter so the white pages stand out. */
.pdf-scroller {
  background: var(--surface-elevated);
}

/* Highlights sit above the text layer but take no pointer events, so text stays selectable;
   multiply keeps the glyphs underneath readable. */
.pdf-scroller :deep(.lily-hl-layer) {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
.pdf-scroller :deep(.lily-hl) {
  position: absolute;
  mix-blend-mode: multiply;
  border-radius: 2px;
  transition: background-color 120ms ease-out;
}
.pdf-scroller :deep(.pdfViewer.over-highlight .textLayer),
.pdf-scroller :deep(.pdfViewer.over-highlight .textLayer span) {
  cursor: pointer;
}
</style>
