<!-- Split-pane layout for a captured web document: the frozen snapshot on the left, the user's
     notes on the right, separated by a draggable divider. Parallels EditorPane's split for .md
     files but is horizontal-only (no swap/rotate) — the two slots have fixed roles here.
     Owns the notes render/code mode so the page's "insert reference" action can flip it to code,
     and draws the hover "leader line" that connects a highlight to its note reference across panes. -->
<script setup lang="ts">
import { ref, watch, useTemplateRef, onBeforeUnmount } from 'vue'
import { useWebAnnotationsStore } from '@/stores/webAnnotations'
import WebView from './WebView.vue'
import WebNotesPane from './WebNotesPane.vue'

const props = defineProps<{ documentId: string; isActive: boolean }>()

const anno = useWebAnnotationsStore()

const container = useTemplateRef<HTMLDivElement>('container')
const webView = useTemplateRef<InstanceType<typeof WebView>>('webView')
// Percentage of the width occupied by the captured page (left). Notes get the remainder.
// Default 60/40 gives the page room to breathe while keeping the notes column usable.
const DEFAULT_PCT = 60
const splitPct = ref(DEFAULT_PCT)
const MIN_PCT = 25
const MAX_PCT = 80
const isDragging = ref(false)

// Notes render/code toggle, lifted here so WebView's "insert reference" can switch to code.
const notesMode = ref<'code' | 'rendered'>('code')
function onInsertReference() {
  notesMode.value = 'code'
}

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

  // Page endpoint: right edge of the highlight, vertical centre clamped to the iframe's visible band
  // so the line stays anchored to the pane edge when the highlight scrolls out of view.
  const midY = (pageRect.top + pageRect.bottom) / 2
  const clampedY = Math.min(Math.max(midY, pageRect.frameTop + 4), pageRect.frameBottom - 4)
  const x1 = pageRect.right - cr.left
  const y1 = clampedY - cr.top

  // Note endpoint: left edge of the chip, vertical centre.
  const x2 = chipRect.left - cr.left
  const y2 = (chipRect.top + chipRect.bottom) / 2 - cr.top

  const dx = Math.max(30, (x2 - x1) * 0.5)
  linePath.value = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
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
 * drag so mouse events are not swallowed by the snapshot iframe on the left.
 */
function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  const el = container.value
  if (!isDragging.value || !el) return
  const rect = el.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  splitPct.value = Math.min(MAX_PCT, Math.max(MIN_PCT, pct))
}

function onMouseUp() {
  isDragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

onBeforeUnmount(() => {
  if (lineRaf) cancelAnimationFrame(lineRaf)
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div ref="container" class="relative h-full w-full overflow-hidden bg-surface">
    <!-- Left: captured page + highlight layer -->
    <div class="absolute inset-y-0 left-0 overflow-hidden" :style="{ width: splitPct + '%' }">
      <WebView
        ref="webView"
        :document-id="documentId"
        class="h-full"
        @insert-reference="onInsertReference"
      />
    </div>

    <!-- Right: notes -->
    <div
      class="absolute inset-y-0 right-0 overflow-hidden border-l border-border"
      :style="{ width: 100 - splitPct + '%' }"
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

    <!-- Divider hit zone (12px wide, centred on the split line) -->
    <div
      class="absolute inset-y-0 z-20 cursor-col-resize group"
      :style="{ left: `calc(${splitPct}% - 6px)`, width: '12px' }"
      @mousedown="onDividerMouseDown"
      @dblclick="splitPct = DEFAULT_PCT"
    >
      <div
        :class="[
          'absolute left-1/2 -translate-x-1/2 inset-y-0 transition-all duration-150',
          isDragging ? 'w-0.5 bg-accent' : 'w-px bg-border-subtle group-hover:bg-border',
        ]"
      />
    </div>

    <!-- Drag overlay: covers the whole pane (including the iframe) while dragging so the
         snapshot iframe doesn't capture mousemove and stall the resize. -->
    <div v-if="isDragging" class="absolute inset-0 z-10 cursor-col-resize" />
  </div>
</template>

<style scoped>
.leader-path {
  stroke: var(--accent);
  opacity: 0.75;
}
.leader-dot {
  fill: var(--accent);
}
</style>
