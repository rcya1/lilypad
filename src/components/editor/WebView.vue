<!-- Renders a captured web snapshot in a sandboxed iframe and hosts the highlight layer:
     paints highlights with the CSS Custom Highlight API (no DOM mutation), detects hover/click on
     them via a caret hit-test (the API is paint-only, so highlights receive no pointer events),
     shows a selection toolbar for creating highlights and an inline-note popover for editing them,
     and links to the notes pane (click a highlight → jump to its reference; notes chip → scroll
     the page here). Also intercepts in-frame link clicks so the frozen snapshot never navigates. -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { StickyNote, Pencil, Trash2, Link2, Check, Loader2 } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import {
  useWebAnnotationsStore,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_KEYS,
  type Highlight,
} from '@/stores/webAnnotations'
import type { HighlightColor } from '@/types/database'
import { serializeRange, resolveRange } from '@/lib/textAnchor'
import { parseMarkdown } from '@/lib/markdown'

const props = defineProps<{ documentId: string }>()
const emit = defineEmits<{ 'insert-reference': [] }>()

const filesStore = useFilesStore()
const editorStore = useEditorStore()
const anno = useWebAnnotationsStore()

const container = ref<HTMLDivElement | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// The live snapshot document/window, set once the iframe loads. Both are same-origin (blob: URL).
let frameDoc: Document | null = null
let frameWin: (Window & typeof globalThis) | null = null
// Blob URL backing the iframe; revoked before loading the next snapshot to avoid leaks.
let blobUrl: string | null = null
// Resolved DOM Ranges per highlight id, rebuilt on every repaint (drives painting + hit-testing).
const resolvedRanges = new Map<string, Range>()

const highlights = computed(() => anno.highlightsFor(props.documentId))

const DEFAULT_COLOR: HighlightColor = 'amber'

// ── Selection toolbar + note popover (positioned in this component, over the iframe) ──────────
const toolbar = ref<{ x: number; y: number } | null>(null)
const popover = ref<{ id: string; x: number; y: number; editing: boolean } | null>(null)
const toolbarEl = ref<HTMLDivElement | null>(null)
const popoverEl = ref<HTMLDivElement | null>(null)
const noteDraft = ref('')

// Save shortcut is ⌘↵ on macOS, Ctrl+↵ elsewhere — label it to match the platform.
const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const saveHint = isMac ? '⌘↵ to save' : 'Ctrl+↵ to save'
// The selection range captured at mouseup, held until the user picks a colour.
let pendingRange: Range | null = null

const popoverHighlight = computed(() =>
  popover.value ? (anno.getById(popover.value.id) ?? null) : null,
)
const popoverNoteHtml = computed(() =>
  popoverHighlight.value?.note ? parseMarkdown(popoverHighlight.value.note) : '',
)

function revoke() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

/**
 * Download the captured HTML and load it into the iframe as a blob: URL, which keeps the frame
 * same-origin so the parent can script into it (paint highlights, read selection/scroll). The
 * iframe is sandboxed WITHOUT allow-scripts, so the captured page's own JS never runs.
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
  // Leave `loading` true here: the iframe hasn't parsed/painted the blob yet, so clearing it now
  // would flash a blank white frame. onFrameLoad clears it once the snapshot is actually up.
  if (frame.value) frame.value.src = blobUrl
}

/** Wire up the loaded snapshot: grab its document, attach listeners, load + paint highlights. */
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

// ── Coordinate mapping ────────────────────────────────────────────────────────────────────────
/**
 * Convert a rect expressed in the iframe's own viewport coordinates into coordinates relative to
 * this component's container (which the toolbar/popover are absolutely positioned within). The
 * iframe's content viewport starts at the iframe's top-left in the page, so we add that offset and
 * subtract the container's own offset.
 */
function toContainer(left: number, top: number): { x: number; y: number } {
  const fr = frame.value?.getBoundingClientRect()
  const cr = container.value?.getBoundingClientRect()
  if (!fr || !cr) return { x: left, y: top }
  return { x: fr.left - cr.left + left, y: fr.top - cr.top + top }
}

/**
 * Nudge an already-positioned overlay (toolbar/popover) back inside the pane if it spills past an
 * edge — the anchor is derived from a selection/highlight rect that can sit anywhere, so near the
 * edges the centred toolbar or the drop-down popover would otherwise clip. Runs after the DOM
 * updates so the element's real measured size is known, then adjusts the stored x/y in place.
 */
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

// ── Painting (CSS Custom Highlight API) ─────────────────────────────────────────────────────────
/** Rebuild the resolved-range cache from stored selectors (exact — the snapshot is immutable). */
function rebuildRanges() {
  resolvedRanges.clear()
  if (!frameDoc?.body) return
  for (const h of highlights.value) {
    const range = resolveRange(frameDoc.body, h.selectors)
    if (range) resolvedRanges.set(h.id, range)
  }
}

/** Inject/refresh the `::highlight()` style rules inside the snapshot document. */
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

/** Repaint everything: rebuild ranges, register CSS highlights, refresh styles. */
function repaint() {
  rebuildRanges()
  writeStyles()
  if (!frameWin) return
  // The Custom Highlight API is per-realm — use the iframe's own CSS/Highlight.
  const cssHighlights = frameWin.CSS?.highlights
  const HighlightCtor = (frameWin as unknown as { Highlight?: typeof Highlight }).Highlight
  if (!cssHighlights || !HighlightCtor) return

  cssHighlights.clear()

  // Base layer: one Highlight per colour.
  for (const key of HIGHLIGHT_COLOR_KEYS) {
    const ranges = highlights.value
      .filter((h) => h.color === key)
      .map((h) => resolvedRanges.get(h.id))
      .filter((r): r is Range => !!r)
    if (ranges.length) cssHighlights.set(`lily-${key}`, new HighlightCtor(...ranges))
  }

  // Emphasis layers (higher priority so they win where they overlap the base paint).
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

// ── Rect hit-testing (find the highlight under a point) ─────────────────────────────────────────
/**
 * The highlight whose *painted* box contains the point (x, y) in iframe viewport coords, if any.
 * We test the range's own client rects rather than a caret hit-test: `caretPositionFromPoint`
 * clamps a point past the end of a line to the nearest caret, so hovering the empty space to the
 * right of the last word would otherwise land on a highlight that ends there. The client rects are
 * the exact glyph boxes, so hovering only triggers over the actual highlighted text.
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

// ── Iframe event handlers ─────────────────────────────────────────────────────────────────────
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
  clampOverlay(() => toolbarEl.value, toolbar.value)
}

function onFrameClick(e: MouseEvent) {
  // 1. Link clicks: keep the frozen snapshot stable (see below) — handle before hit-testing.
  const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    handleAnchorClick(e, anchor)
    return
  }

  // 2. Highlight clicks: focus it, open its note popover, and jump the notes to its reference.
  const h = highlightAtPoint(e.clientX, e.clientY)
  if (h) {
    anno.setActiveHighlight(h.id)
    openPopover(h)
    anno.requestScrollToNote(props.documentId, h.localId)
    repaint()
    return
  }

  // 3. Empty space: clear focus and close the popover.
  if (anno.activeHighlightId) {
    anno.setActiveHighlight(null)
    repaint()
  }
  popover.value = null
}

function onFrameScroll() {
  // Selection toolbar anchors to a now-moving rect — hide it. Keep the popover pinned to its
  // highlight by recomputing its position.
  toolbar.value = null
  if (popover.value) {
    const r = resolvedRanges.get(popover.value.id)
    if (r) {
      const rect = r.getBoundingClientRect()
      const pos = toContainer(rect.left, rect.bottom + 6)
      popover.value = { ...popover.value, x: pos.x, y: pos.y }
      clampOverlay(() => popoverEl.value, popover.value)
    }
  }
}

/**
 * A captured page keeps its live <a href> elements, and the injected <base href> resolves them to
 * the original site — so a click would navigate the iframe away from the snapshot. Intercept:
 * in-page #fragment links scroll within the snapshot; external links open in a new browser tab.
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

// ── Highlight creation / editing ────────────────────────────────────────────────────────────────
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

/** Toolbar "add note": create a highlight (default colour) and open its popover in edit mode. */
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
  noteDraft.value = h.note
  popover.value = { id: h.id, x: pos.x, y: pos.y, editing: editing || !h.note }
  clampOverlay(() => popoverEl.value, popover.value)
}

function startEditNote() {
  if (!popover.value) return
  noteDraft.value = popoverHighlight.value?.note ?? ''
  popover.value = { ...popover.value, editing: true }
}

async function saveNote() {
  if (!popover.value) return
  await anno.updateNote(popover.value.id, noteDraft.value.trim())
  popover.value = { ...popover.value, editing: false }
}

/** Escape out of note editing: drop the draft and return to the rendered view. */
function cancelEditNote() {
  if (!popover.value) return
  noteDraft.value = popoverHighlight.value?.note ?? ''
  popover.value = { ...popover.value, editing: false }
}

async function setPopoverColor(color: HighlightColor) {
  if (!popover.value) return
  await anno.updateColor(popover.value.id, color)
  repaint()
}

async function deletePopoverHighlight() {
  if (!popover.value) return
  await anno.deleteHighlight(popover.value.id)
  popover.value = null
  repaint()
}

/** Insert `[quote](lily:hl-x)` at the notes cursor and flip the notes pane to code mode. */
function insertReference() {
  const h = popoverHighlight.value
  if (!h) return
  const quote = h.selectors.quote.exact
  const label = quote.length > 40 ? quote.slice(0, 40).trim() + '…' : quote
  editorStore.requestInsertText(props.documentId, `[${label}](lily:${h.localId})`)
  emit('insert-reference')
}

function closeOverlays() {
  toolbar.value = null
  popover.value = null
  pendingRange = null
}

// Escape dismisses whichever overlay is open (popover first). Note-editing Escape is handled on the
// textarea itself with `.stop`, so it cancels the edit before this window handler ever sees it.
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

// Click-away: a mousedown anywhere in the parent document that lands outside the overlays closes
// them. Clicks *inside* the snapshot iframe never reach here (they don't cross the frame boundary),
// so opening a popover by clicking a highlight isn't immediately undone by this handler.
function onWindowMouseDown(e: MouseEvent) {
  const t = e.target as Node
  if (toolbar.value && !toolbarEl.value?.contains(t)) toolbar.value = null
  if (popover.value && !popoverEl.value?.contains(t)) {
    popover.value = null
    if (anno.activeHighlightId) {
      anno.setActiveHighlight(null)
      repaint()
    }
  }
}

// ── React to cross-pane requests ────────────────────────────────────────────────────────────────
// A notes chip was clicked → scroll the page to the highlight and focus it.
watch(
  () => anno.scrollToHighlightRequest,
  (id) => {
    if (!id) return
    anno.scrollToHighlightRequest = null
    const h = anno.getById(id)
    if (!h || h.entryId !== props.documentId) return
    anno.setActiveHighlight(id)
    // Ensure the range is resolved before measuring/scrolling.
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

// Repaint when highlights change (create/delete/colour) or focus changes from the notes side.
watch(highlights, () => repaint(), { deep: true })
watch(
  () => [anno.activeHighlightId, anno.hoveredHighlightId],
  () => repaint(),
)

// Reload whenever the displayed document changes. immediate: true covers the initial mount.
watch(
  () => props.documentId,
  (id) => {
    closeOverlays()
    nextTick(() => load(id))
  },
  { immediate: true },
)

// ── Geometry for the leader line (WebDocPane draws it across both panes) ─────────────────────────
/** Rect of a highlight in the main page's viewport coordinates, plus the iframe's visible band
 *  (so the caller can clamp the line's endpoint when the highlight is scrolled off-screen).
 *  Returns null if the highlight can't be resolved or has no box. */
function highlightViewportRect(id: string): {
  left: number
  top: number
  right: number
  bottom: number
  frameTop: number
  frameBottom: number
  frameLeft: number
  frameRight: number
} | null {
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

    <!-- Selection toolbar: colour swatches + add-note, anchored above the selection. -->
    <div
      v-if="toolbar"
      ref="toolbarEl"
      class="overlay-pop absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-lg bg-surface border border-border shadow-lg -translate-x-1/2 -translate-y-full"
      :style="{ left: toolbar.x + 'px', top: toolbar.y - 8 + 'px' }"
    >
      <button
        v-for="key in HIGHLIGHT_COLOR_KEYS"
        :key="key"
        class="w-5 h-5 rounded-full border border-black/10 cursor-pointer transition-transform hover:scale-110"
        :style="{ backgroundColor: HIGHLIGHT_COLORS[key].swatch }"
        :title="`Highlight ${key}`"
        @click="createFromSelection(key)"
      />
      <div class="w-px h-4 bg-border mx-0.5" />
      <button
        class="flex items-center justify-center w-6 h-6 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated cursor-pointer"
        title="Highlight and add a note"
        @click="createAndAnnotate"
      >
        <StickyNote :size="14" />
      </button>
    </div>

    <!-- Inline note popover for the active highlight. -->
    <div
      v-if="popover"
      ref="popoverEl"
      class="overlay-pop absolute z-30 w-72 max-w-[90%] rounded-lg bg-surface border border-border shadow-xl -translate-x-1/2"
      :style="{ left: popover.x + 'px', top: popover.y + 'px' }"
    >
      <!-- Colour row + actions -->
      <div class="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle">
        <div class="flex items-center gap-1">
          <button
            v-for="key in HIGHLIGHT_COLOR_KEYS"
            :key="key"
            class="w-4 h-4 rounded-full border cursor-pointer transition-transform hover:scale-110"
            :class="popoverHighlight?.color === key ? 'border-text-primary' : 'border-black/10'"
            :style="{ backgroundColor: HIGHLIGHT_COLORS[key].swatch }"
            :title="`Set colour ${key}`"
            @click="setPopoverColor(key)"
          />
        </div>
        <div class="flex items-center gap-0.5">
          <button
            v-if="!popover.editing"
            class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated cursor-pointer"
            title="Edit note"
            @click="startEditNote"
          >
            <Pencil :size="13" />
          </button>
          <button
            class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated cursor-pointer"
            title="Insert reference into notes"
            @click="insertReference"
          >
            <Link2 :size="13" />
          </button>
          <button
            class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-red-500 hover:bg-surface-elevated cursor-pointer"
            title="Delete highlight"
            @click="deletePopoverHighlight"
          >
            <Trash2 :size="13" />
          </button>
        </div>
      </div>

      <!-- Note body: rendered view or editor -->
      <div class="p-2.5">
        <template v-if="popover.editing">
          <textarea
            v-model="noteDraft"
            rows="3"
            placeholder="Write a note (markdown supported)…"
            class="w-full resize-y rounded border border-border-subtle bg-bg px-2 py-1.5 text-sm font-preview text-text-primary outline-none focus:border-accent"
            @keydown.enter.meta.prevent="saveNote"
            @keydown.enter.ctrl.prevent="saveNote"
            @keydown.esc.stop.prevent="cancelEditNote"
            v-focus
          />
          <div class="flex items-center justify-between mt-1.5">
            <span class="text-[11px] text-text-muted font-ui">{{ saveHint }}</span>
            <button
              class="flex items-center gap-1 h-6 px-2 rounded bg-accent text-white text-xs font-ui cursor-pointer hover:bg-accent-hover"
              @click="saveNote"
            >
              <Check :size="13" />
              Save
            </button>
          </div>
        </template>
        <template v-else>
          <div
            v-if="popoverNoteHtml"
            class="hl-note-body text-sm font-preview text-text-primary leading-snug"
            v-html="popoverNoteHtml"
          />
          <p v-else class="text-sm text-text-muted italic">No note yet.</p>
        </template>
      </div>
    </div>

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

<style scoped>
/* Overlays (selection toolbar, note popover) fade in so they don't pop abruptly. Only opacity is
   animated — the elements rely on translate utilities for positioning, which a transform-based
   animation would fight. */
.overlay-pop {
  animation: overlay-in 120ms ease-out;
}
@keyframes overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.hl-note-body :deep(p) {
  margin: 0.25em 0;
}
.hl-note-body :deep(p:first-child) {
  margin-top: 0;
}
.hl-note-body :deep(p:last-child) {
  margin-bottom: 0;
}
.hl-note-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}
.hl-note-body :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  background: var(--surface-elevated);
  border-radius: 3px;
  padding: 0.05em 0.3em;
}
</style>
