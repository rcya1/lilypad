<!-- Split-pane layout for a captured web document: the frozen snapshot in one slot, the user's
     notes in the other, separated by a draggable divider. Honours the same layout/swap toggles as
     EditorPane's markdown split (driven by the tab-bar rotate/swap buttons): `isVertical` stacks the
     panes, `isSwapped` exchanges which pane is primary. Owns the notes render/code mode (so the
     page's "insert reference" can flip it to code, and Ctrl+E toggles it), and draws the hover
     "leader line" that connects a highlight to its note reference across panes. -->
<script setup lang="ts">
import { ref, computed, watch, useTemplateRef, onMounted, onBeforeUnmount } from 'vue'
import { useWebAnnotationsStore } from '@/stores/webAnnotations'
import WebView from './WebView.vue'
import WebNotesPane from './WebNotesPane.vue'

const props = defineProps<{
  documentId: string
  isActive: boolean
  isVertical: boolean
  isSwapped: boolean
}>()

const anno = useWebAnnotationsStore()

const container = useTemplateRef<HTMLDivElement>('container')
const webView = useTemplateRef<InstanceType<typeof WebView>>('webView')
// Percentage of the primary axis occupied by the first slot. Notes get the remainder.
// Default 60/40 gives the page room to breathe while keeping the notes column usable.
const DEFAULT_PCT = 60
const splitPct = ref(DEFAULT_PCT)
const MIN_PCT = 25
const MAX_PCT = 80
const isDragging = ref(false)

// Notes render/code toggle, lifted here so WebView's "insert reference" can switch to code and the
// Ctrl+E shortcut can flip it from anywhere in the pane.
const notesMode = ref<'code' | 'rendered'>('code')
function onInsertReference() {
  notesMode.value = 'code'
}

// ── Layout (mirrors EditorPane) ─────────────────────────────────────────────────────────────────
/** Absolute-position style for one slot; `inFirst` is the left/top slot, else right/bottom. */
function slotStyle(inFirst: boolean) {
  if (!props.isVertical) {
    return inFirst
      ? { left: '0%', top: '0%', width: `${splitPct.value}%`, height: '100%' }
      : { left: `${splitPct.value}%`, top: '0%', width: `${100 - splitPct.value}%`, height: '100%' }
  }
  return inFirst
    ? { left: '0%', top: '0%', width: '100%', height: `${splitPct.value}%` }
    : { left: '0%', top: `${splitPct.value}%`, width: '100%', height: `${100 - splitPct.value}%` }
}
// The captured page is the primary slot unless swapped; the notes take the other.
const pageStyle = computed(() => slotStyle(!props.isSwapped))
const notesStyle = computed(() => slotStyle(props.isSwapped))

const dividerHitZoneStyle = computed(() =>
  props.isVertical
    ? { top: `calc(${splitPct.value}% - 6px)`, left: '0', height: '12px', width: '100%' }
    : { left: `calc(${splitPct.value}% - 6px)`, top: '0', width: '12px', height: '100%' },
)
const dividerLineClass = computed(() => {
  if (isDragging.value) {
    return props.isVertical
      ? 'top-1/2 -translate-y-1/2 inset-x-0 h-0.5 bg-accent'
      : 'left-1/2 -translate-x-1/2 inset-y-0 w-0.5 bg-accent'
  }
  return props.isVertical
    ? 'top-1/2 -translate-y-1/2 inset-x-0 h-px bg-border-subtle group-hover:bg-border'
    : 'left-1/2 -translate-x-1/2 inset-y-0 w-px bg-border-subtle group-hover:bg-border'
})

// Reset to the default split when the orientation flips so neither pane starts cramped.
watch(
  () => props.isVertical,
  () => (splitPct.value = DEFAULT_PCT),
)

// ── Leader line ─────────────────────────────────────────────────────────────────────────────────
// A Bézier curve connecting the hovered highlight (in the page iframe) to its reference chip (in the
// rendered notes). Redrawn every frame while a highlight is hovered so it tracks both scroll sources
// (the iframe scrolls independently of the notes pane). Only drawn when both endpoints exist — i.e.
// the highlight resolves AND the notes are in rendered mode with a chip that references it.
const linePath = ref('')
const endpoints = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
let lineRaf = 0

function clearLine() {
  linePath.value = ''
  endpoints.value = null
}

function tick() {
  const h = anno.hoveredHighlightId ? anno.getById(anno.hoveredHighlightId) : null
  const cont = container.value
  if (!h || h.entryId !== props.documentId || !cont) {
    clearLine()
    lineRaf = 0 // hover cleared → stop the loop (restarted by the watcher below)
    return
  }

  const pageRect = webView.value?.highlightViewportRect(h.id)
  const chipEl = cont.querySelector<HTMLElement>(
    `.markdown-body [data-lily-ref="${CSS.escape(h.localId)}"]`,
  )
  if (!pageRect || !chipEl) {
    // Endpoints not both available yet (code mode, off-screen, still rendering) — keep polling.
    clearLine()
    lineRaf = requestAnimationFrame(tick)
    return
  }

  const cr = cont.getBoundingClientRect()
  const chipRect = chipEl.getBoundingClientRect()

  // Endpoints sit on whichever edge of each element faces the divider. The page endpoint's
  // free-axis centre is clamped to the iframe's visible band so the line stays anchored to the pane
  // edge when the highlight scrolls out of view.
  let x1: number, y1: number, x2: number, y2: number
  if (!props.isVertical) {
    // Horizontal split (vertical divider): connect left/right edges.
    const midY = (pageRect.top + pageRect.bottom) / 2
    const clampedY = Math.min(Math.max(midY, pageRect.frameTop + 4), pageRect.frameBottom - 4)
    x1 = (props.isSwapped ? pageRect.left : pageRect.right) - cr.left
    y1 = clampedY - cr.top
    x2 = (props.isSwapped ? chipRect.right : chipRect.left) - cr.left
    y2 = (chipRect.top + chipRect.bottom) / 2 - cr.top
  } else {
    // Vertical split (horizontal divider): connect top/bottom edges.
    const midX = (pageRect.left + pageRect.right) / 2
    const clampedX = Math.min(Math.max(midX, pageRect.frameLeft + 4), pageRect.frameRight - 4)
    x1 = clampedX - cr.left
    y1 = (props.isSwapped ? pageRect.top : pageRect.bottom) - cr.top
    x2 = (chipRect.left + chipRect.right) / 2 - cr.left
    y2 = (props.isSwapped ? chipRect.bottom : chipRect.top) - cr.top
  }

  // Control handles extend along the primary axis toward the other endpoint, so the curve leaves
  // each endpoint perpendicular to its pane edge in every orientation.
  if (!props.isVertical) {
    const dir = Math.sign(x2 - x1) || 1
    const len = Math.max(30, Math.abs(x2 - x1) * 0.5)
    linePath.value = `M ${x1} ${y1} C ${x1 + dir * len} ${y1}, ${x2 - dir * len} ${y2}, ${x2} ${y2}`
  } else {
    const dir = Math.sign(y2 - y1) || 1
    const len = Math.max(30, Math.abs(y2 - y1) * 0.5)
    linePath.value = `M ${x1} ${y1} C ${x1} ${y1 + dir * len}, ${x2} ${y2 - dir * len}, ${x2} ${y2}`
  }
  endpoints.value = { x1, y1, x2, y2 }
  lineRaf = requestAnimationFrame(tick)
}

// Start the redraw loop when a highlight becomes hovered; tick() stops itself when it clears.
watch(
  () => anno.hoveredHighlightId,
  (id) => {
    if (id && !lineRaf) lineRaf = requestAnimationFrame(tick)
  },
)

/**
 * Begin a divider drag. Window-level listeners keep the drag alive even if the cursor
 * outruns the 12px hit zone. A full-container overlay (see template) is shown during the
 * drag so mouse events are not swallowed by the snapshot iframe.
 */
function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  document.body.style.cursor = props.isVertical ? 'row-resize' : 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  const el = container.value
  if (!isDragging.value || !el) return
  const rect = el.getBoundingClientRect()
  const pct = props.isVertical
    ? ((e.clientY - rect.top) / rect.height) * 100
    : ((e.clientX - rect.left) / rect.width) * 100
  splitPct.value = Math.min(MAX_PCT, Math.max(MIN_PCT, pct))
}

function onMouseUp() {
  isDragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

// Ctrl/Cmd+E toggles the notes between rendered and code. Capture phase + preventDefault so it wins
// over CodeMirror's own Ctrl+E binding when the source editor has focus.
function onKeyDown(e: KeyboardEvent) {
  if (!props.isActive) return
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault()
    e.stopPropagation()
    notesMode.value = notesMode.value === 'code' ? 'rendered' : 'code'
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown, true))

onBeforeUnmount(() => {
  if (lineRaf) cancelAnimationFrame(lineRaf)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeyDown, true)
})
</script>

<template>
  <div ref="container" class="relative h-full w-full overflow-hidden bg-surface">
    <!-- Captured page + highlight layer -->
    <div
      class="absolute overflow-hidden web-slot"
      :class="{ 'no-transition': isDragging }"
      :style="pageStyle"
    >
      <WebView
        ref="webView"
        :document-id="documentId"
        class="h-full"
        @insert-reference="onInsertReference"
      />
    </div>

    <!-- Notes -->
    <div
      class="absolute overflow-hidden web-slot"
      :class="{ 'no-transition': isDragging }"
      :style="notesStyle"
    >
      <WebNotesPane
        :document-id="documentId"
        :is-active="isActive"
        :mode="notesMode"
        class="h-full"
        @update:mode="notesMode = $event"
      />
    </div>

    <!-- Leader line overlay (pointer-events-none so it never blocks the divider or panes) -->
    <svg
      v-if="linePath"
      class="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
    >
      <path
        :d="linePath"
        class="leader-path"
        fill="none"
        stroke-width="1.75"
        stroke-linecap="round"
      />
      <circle v-if="endpoints" :cx="endpoints.x1" :cy="endpoints.y1" r="3" class="leader-dot" />
      <circle v-if="endpoints" :cx="endpoints.x2" :cy="endpoints.y2" r="3" class="leader-dot" />
    </svg>

    <!-- Divider hit zone (12px, centred on the split line) -->
    <div
      class="absolute z-20 group"
      :class="isVertical ? 'cursor-row-resize' : 'cursor-col-resize'"
      :style="dividerHitZoneStyle"
      @mousedown="onDividerMouseDown"
      @dblclick="splitPct = DEFAULT_PCT"
    >
      <div :class="['absolute transition-all duration-150', dividerLineClass]" />
    </div>

    <!-- Drag overlay: covers the whole pane (including the iframe) while dragging so the
         snapshot iframe doesn't capture mousemove and stall the resize. -->
    <div
      v-if="isDragging"
      class="absolute inset-0 z-10"
      :class="isVertical ? 'cursor-row-resize' : 'cursor-col-resize'"
    />
  </div>
</template>

<style scoped>
.web-slot {
  transition:
    left 250ms cubic-bezier(0.4, 0, 0.2, 1),
    top 250ms cubic-bezier(0.4, 0, 0.2, 1),
    width 250ms cubic-bezier(0.4, 0, 0.2, 1),
    height 250ms cubic-bezier(0.4, 0, 0.2, 1);
}
.web-slot.no-transition {
  transition: none;
}
.leader-path {
  stroke: var(--accent);
  opacity: 0.75;
}
.leader-dot {
  fill: var(--accent);
}
</style>
