<!-- A read-only captured web page with its highlights, next to the rendered notes (side by side
     once
     the note area is ≥ 60rem, else a Page / Notes toggle). Highlights and their reference chips link to
     each other. The parent keys it per entry. -->
<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { ExternalLink, Loader2 } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import {
  useAnnotationsStore,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_KEYS,
  type Highlight,
} from '@/stores/annotations'
import { parseMarkdown } from '@/lib/markdown'
import { resolveRange } from '@/lib/textAnchor'
import { isPdfSelectors } from '@/types/database'

const props = defineProps<{ entryId: string }>()
const filesStore = useFilesStore()
const anno = useAnnotationsStore()

const container = useTemplateRef<HTMLDivElement>('container')
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const notesPane = useTemplateRef<HTMLDivElement>('notesPane')

// Narrow screens show one pane at a time.
const pane = ref<'page' | 'notes'>('page')
const pageLoading = ref(true)
const pageError = ref(false)
const notesHtml = ref('')
const notesLoading = ref(true)

const sourceUrl = computed(() => filesStore.getEntry(props.entryId)?.metadata?.url ?? null)
const sourceHost = computed(() => {
  if (!sourceUrl.value) return null
  try {
    return new URL(sourceUrl.value).hostname.replace(/^www\./, '')
  } catch {
    return sourceUrl.value
  }
})

const highlights = computed(() => anno.highlightsFor(props.entryId))

// A same-origin blob URL, so the frame is scriptable; sandboxed without allow-scripts.
let blobUrl: string | null = null
let frameDoc: Document | null = null
let frameWin: (Window & typeof globalThis) | null = null
const resolvedRanges = new Map<string, Range>()
// Highlight briefly emphasised after jumping to it from a notes chip.
let focusedId: string | null = null
let focusTimer = 0
// Under the pointer, on the page or via a chip: emphasised on the page, its chips marked, and a
// leader line drawn between them when both panes are showing.
const hoveredId = ref<string | null>(null)
let hoverRaf = 0

async function loadPage() {
  const html = await filesStore.downloadSnapshot(props.entryId)
  if (html == null) {
    pageError.value = true
    pageLoading.value = false
    return
  }
  blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  // pageLoading stays true until the frame has actually painted (onFrameLoad).
  if (frame.value) frame.value.src = blobUrl
}

async function loadNotes() {
  const content =
    filesStore.getCached(props.entryId) ?? (await filesStore.downloadContent(props.entryId))
  notesHtml.value = content?.trim()
    ? parseMarkdown(content, (id) => filesStore.getImageUrl(id))
    : ''
  notesLoading.value = false
}

async function onFrameLoad() {
  // The initial about:blank load fires before the snapshot's src is set — ignore it.
  if (!blobUrl) return
  frameDoc = frame.value?.contentDocument ?? null
  frameWin = (frame.value?.contentWindow as (Window & typeof globalThis) | null) ?? null
  if (frameDoc) {
    frameDoc.addEventListener('click', onFrameClick)
    frameDoc.addEventListener('mousemove', onFrameMouseMove)
    // mouseleave doesn't fire on a Document, only on its elements.
    frameDoc.documentElement.addEventListener('mouseleave', onFrameMouseLeave)
  }
  await anno.loadForEntry(props.entryId)
  repaint()
  pageLoading.value = false
}

function repaint() {
  resolvedRanges.clear()
  if (!frameDoc?.body || !frameWin) return
  for (const h of highlights.value) {
    if (isPdfSelectors(h.selectors)) continue
    const range = resolveRange(frameDoc.body, h.selectors)
    if (range) resolvedRanges.set(h.id, range)
  }

  let styleEl = frameDoc.getElementById('lily-hl-style') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = frameDoc.createElement('style')
    styleEl.id = 'lily-hl-style'
    frameDoc.head.appendChild(styleEl)
  }
  const rules = HIGHLIGHT_COLOR_KEYS.map(
    (key) => `::highlight(lily-${key}){ background-color: ${HIGHLIGHT_COLORS[key].base}; }`,
  )
  // One emphasis layer: the hovered highlight, else the one just jumped to from a chip.
  const emphasisId = hoveredId.value ?? focusedId
  const focused = emphasisId ? anno.getById(emphasisId) : null
  if (focused) {
    rules.push(
      `::highlight(lily-focus){ background-color: ${HIGHLIGHT_COLORS[focused.color].active}; }`,
    )
  }
  styleEl.textContent = rules.join('\n')

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
  const focusRange = emphasisId ? resolvedRanges.get(emphasisId) : null
  if (focusRange) {
    const hl = new HighlightCtor(focusRange)
    hl.priority = 1
    cssHighlights.set('lily-focus', hl)
  }
}

/** Tests the painted glyph boxes (frame viewport coordinates). */
function highlightAtPoint(x: number, y: number): Highlight | null {
  for (const h of highlights.value) {
    const range = resolvedRanges.get(h.id)
    if (!range) continue
    for (const r of range.getClientRects()) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return h
    }
  }
  return null
}

function setHovered(id: string | null) {
  if (id === hoveredId.value) return
  hoveredId.value = id
  repaint()
}

function onFrameMouseMove(e: MouseEvent) {
  if (hoverRaf) return
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0
    const h = highlightAtPoint(e.clientX, e.clientY)
    if (frameDoc) frameDoc.body.style.cursor = h ? 'pointer' : ''
    setHovered(h?.id ?? null)
  })
}

function onFrameMouseLeave() {
  setHovered(null)
}

function chipAt(target: EventTarget | null): HTMLElement | null {
  return ((target as HTMLElement | null)?.closest?.('[data-lily-ref]') as HTMLElement) ?? null
}

function onNotesMouseOver(e: MouseEvent) {
  const chip = chipAt(e.target)
  if (!chip) return
  const h = anno.findByLocalId(props.entryId, chip.getAttribute('data-lily-ref') ?? '')
  setHovered(h?.id ?? null)
}

function onNotesMouseOut(e: MouseEvent) {
  const chip = chipAt(e.target)
  // Moving between a chip's own child nodes isn't leaving it.
  if (!chip || chip.contains(e.relatedTarget as Node | null)) return
  setHovered(null)
}

watch(hoveredId, (id) => {
  const pane = notesPane.value
  if (!pane) return
  pane.querySelectorAll('.lily-ref-active').forEach((el) => el.classList.remove('lily-ref-active'))
  const h = id ? anno.getById(id) : null
  if (!h) return
  pane
    .querySelectorAll(`[data-lily-ref="${CSS.escape(h.localId)}"]`)
    .forEach((el) => el.classList.add('lily-ref-active'))
})

// From the highlight (in the page) to its chip (in the notes), redrawn every frame while hovered so
// it follows both panes' scrolling.
const leader = ref<{ path: string; x1: number; y1: number; x2: number; y2: number } | null>(null)
let lineRaf = 0

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

function drawLeader() {
  lineRaf = 0
  const h = hoveredId.value ? anno.getById(hoveredId.value) : null
  const range = h ? resolvedRanges.get(h.id) : null
  const cont = container.value
  const fr = frame.value
  const pane = notesPane.value
  if (!h || !range || !cont || !fr || !pane) {
    leader.value = null
    return // hover cleared → stop (restarted by the watcher below)
  }
  const chip = pane.querySelector<HTMLElement>(`[data-lily-ref="${CSS.escape(h.localId)}"]`)
  const frameRect = fr.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const rangeRect = range.getBoundingClientRect()
  if (!chip || frameRect.width === 0 || paneRect.width === 0 || rangeRect.height === 0) {
    // No chip references this highlight, or a pane is hidden — nothing to connect; keep polling.
    leader.value = null
    lineRaf = requestAnimationFrame(drawLeader)
    return
  }
  const cr = cont.getBoundingClientRect()
  const chipRect = chip.getBoundingClientRect()
  // The range rect is in the frame's own viewport coordinates; offset by the frame's position.
  // Both ends are clamped to their pane's visible band, so the line stays anchored off-screen.
  const x1 = Math.min(frameRect.left + rangeRect.right, frameRect.right) - cr.left
  const y1 =
    clamp(
      frameRect.top + (rangeRect.top + rangeRect.bottom) / 2,
      frameRect.top + 4,
      frameRect.bottom - 4,
    ) - cr.top
  const x2 = chipRect.left - cr.left
  const y2 =
    clamp((chipRect.top + chipRect.bottom) / 2, paneRect.top + 4, paneRect.bottom - 4) - cr.top
  const len = Math.max(30, Math.abs(x2 - x1) * 0.5)
  leader.value = {
    path: `M ${x1} ${y1} C ${x1 + len} ${y1}, ${x2 - len} ${y2}, ${x2} ${y2}`,
    x1,
    y1,
    x2,
    y2,
  }
  lineRaf = requestAnimationFrame(drawLeader)
}

watch(hoveredId, (id) => {
  if (id && !lineRaf) lineRaf = requestAnimationFrame(drawLeader)
})

function onFrameClick(e: MouseEvent) {
  const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    handleAnchorClick(e, anchor)
    return
  }
  const h = highlightAtPoint(e.clientX, e.clientY)
  if (h) void revealChip(h.localId)
}

/**
 * Captured links resolve to the original site, so a click would navigate away from the snapshot.
 * #fragments scroll within it; external links open in a new tab.
 */
function handleAnchorClick(e: MouseEvent, anchor: HTMLAnchorElement) {
  e.preventDefault()
  const raw = anchor.getAttribute('href') ?? ''
  if (raw.startsWith('#')) {
    const id = decodeURIComponent(raw.slice(1))
    if (!id) return
    const target =
      frameDoc?.getElementById(id) ?? frameDoc?.querySelector(`a[name="${CSS.escape(id)}"]`)
    target?.scrollIntoView({ behavior: 'smooth' })
  } else if (/^https?:/i.test(anchor.href)) {
    window.open(anchor.href, '_blank', 'noopener,noreferrer')
  }
}

/** Notes chip → show the page and scroll its highlight into view, briefly emphasised. */
async function onNotesClick(e: MouseEvent) {
  const chip = (e.target as HTMLElement).closest?.('[data-lily-ref]')
  if (!chip) return
  const h = anno.findByLocalId(props.entryId, chip.getAttribute('data-lily-ref') ?? '')
  const range = h ? resolvedRanges.get(h.id) : null
  if (!h || !range) return
  pane.value = 'page'
  await nextTick()
  const el =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  focusedId = h.id
  repaint()
  clearTimeout(focusTimer)
  focusTimer = window.setTimeout(() => {
    focusedId = null
    repaint()
  }, 1600)
}

/** Page highlight → show the notes and flash the chip that references it. */
async function revealChip(localId: string) {
  pane.value = 'notes'
  await nextTick()
  const chip = notesPane.value?.querySelector<HTMLElement>(
    `[data-lily-ref="${CSS.escape(localId)}"]`,
  )
  if (!chip) return
  chip.scrollIntoView({ behavior: 'smooth', block: 'center' })
  chip.classList.remove('lily-ref-flash')
  void chip.offsetWidth // restart the animation if it's already running
  chip.classList.add('lily-ref-flash')
}

onMounted(() => {
  void loadPage()
  void loadNotes()
})

onBeforeUnmount(() => {
  clearTimeout(focusTimer)
  cancelAnimationFrame(hoverRaf)
  cancelAnimationFrame(lineRaf)
  frameDoc?.removeEventListener('click', onFrameClick)
  frameDoc?.removeEventListener('mousemove', onFrameMouseMove)
  frameDoc?.documentElement.removeEventListener('mouseleave', onFrameMouseLeave)
  if (blobUrl) URL.revokeObjectURL(blobUrl)
})
</script>

<template>
  <div ref="container" class="relative flex h-full min-h-0 flex-col @min-[60rem]:flex-row">
    <!-- Narrow screens: Page / Notes toggle -->
    <div
      class="flex shrink-0 justify-center border-b border-border-subtle px-3 py-2 @min-[60rem]:hidden"
    >
      <div class="flex rounded-lg bg-surface p-0.5 font-ui text-sm">
        <button
          v-for="p in ['page', 'notes'] as const"
          :key="p"
          class="min-h-8 rounded-md px-4 capitalize transition-colors duration-150"
          :class="
            pane === p
              ? 'bg-bg text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          "
          @click="pane = p"
        >
          {{ p }}
        </button>
      </div>
    </div>

    <section
      class="relative min-h-0 flex-1 @min-[60rem]:flex"
      :class="pane === 'page' ? 'flex' : 'hidden'"
      aria-label="Captured page"
    >
      <iframe
        ref="frame"
        title="Captured page"
        class="h-full w-full border-0 bg-white transition-opacity duration-300"
        :class="pageLoading ? 'opacity-0' : 'opacity-100'"
        sandbox="allow-same-origin"
        @load="onFrameLoad"
      />
      <div
        v-if="pageLoading || pageError"
        class="absolute inset-0 flex items-center justify-center bg-bg"
      >
        <Loader2 v-if="!pageError" :size="24" class="animate-spin text-text-muted" />
        <p v-else class="font-ui text-sm text-text-secondary">Could not load the captured page.</p>
      </div>
    </section>

    <section
      ref="notesPane"
      class="min-h-0 flex-1 flex-col overflow-y-auto @min-[60rem]:flex @min-[60rem]:w-[40%] @min-[60rem]:max-w-[34rem] @min-[60rem]:min-w-[20rem] @min-[60rem]:flex-none @min-[60rem]:border-l @min-[60rem]:border-border-subtle"
      :class="pane === 'notes' ? 'flex' : 'hidden'"
      aria-label="Notes"
    >
      <a
        v-if="sourceUrl"
        :href="sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="mx-4 mt-3 flex items-center gap-1.5 self-start rounded-md px-2 py-1 font-ui text-xs text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary"
      >
        <ExternalLink :size="13" />
        <span class="truncate">{{ sourceHost }}</span>
      </a>
      <div v-if="notesLoading" class="flex justify-center py-12">
        <Loader2 :size="20" class="animate-spin text-text-muted" />
      </div>
      <article
        v-else-if="notesHtml"
        class="markdown-body motion-safe:animate-fade-up px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] font-preview text-[15px] leading-[1.7] text-text-primary"
        @click="onNotesClick"
        @mouseover="onNotesMouseOver"
        @mouseout="onNotesMouseOut"
        v-html="notesHtml"
      />
      <p v-else class="px-6 py-12 text-center font-ui text-sm text-text-muted">
        No notes on this page yet.
      </p>
    </section>

    <!-- Leader line (pointer-events-none) -->
    <svg
      v-if="leader"
      class="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      <path
        :d="leader.path"
        class="stroke-accent opacity-75"
        fill="none"
        stroke-width="1.75"
        stroke-linecap="round"
      />
      <circle :cx="leader.x1" :cy="leader.y1" r="3" class="fill-accent" />
      <circle :cx="leader.x2" :cy="leader.y2" r="3" class="fill-accent" />
    </svg>
  </div>
</template>
