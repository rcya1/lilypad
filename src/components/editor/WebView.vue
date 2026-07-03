<!-- Renders a captured web snapshot in a sandboxed iframe; intercepts link clicks to prevent navigation away from the frozen page. -->
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useFilesStore } from '@/stores/files'

const props = defineProps<{ documentId: string }>()

const filesStore = useFilesStore()

const frame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
// Tracks the current blob: URL so we can revoke it before loading the next snapshot,
// preventing unbounded memory growth from orphaned Blob objects.
let blobUrl: string | null = null

/** Revoke the current blob URL, freeing the underlying memory. */
function revoke() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

/**
 * Download the captured HTML for the given document and load it into the iframe.
 * Creating a blob: URL (rather than a data: URL) keeps the iframe same-origin with
 * this page, which lets our click handler script into the frame's document.
 * The sandbox="allow-same-origin" attribute is intentionally omitted from allow-scripts,
 * so the captured page's own JS is never executed.
 */
async function load(id: string) {
  loading.value = true
  error.value = null
  revoke()
  const html = await filesStore.downloadSnapshot(id)
  if (html == null) {
    error.value = 'Could not load the captured page.'
    loading.value = false
    return
  }
  // blob: URL inherits this document's origin → parent can script into the frame.
  // Sandboxed without allow-scripts, so captured page JS never runs.
  blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  if (frame.value) frame.value.src = blobUrl
  loading.value = false
}

/**
 * Keep the frozen snapshot stable: a captured page still has live <a href> elements, and the
 * injected <base href> resolves them to the original site — so a click would otherwise navigate
 * the iframe away from the snapshot (and our future highlights). Intercept clicks instead:
 *   - in-page #fragment links scroll within the snapshot,
 *   - external links open in a new browser tab.
 */
function onFrameLoad() {
  const doc = frame.value?.contentDocument
  if (!doc) return
  doc.addEventListener('click', onAnchorClick)
}

function onAnchorClick(e: MouseEvent) {
  const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor) return

  const raw = anchor.getAttribute('href') ?? ''

  // In-page fragment link → scroll to the target inside the snapshot.
  if (raw.startsWith('#')) {
    e.preventDefault()
    const id = decodeURIComponent(raw.slice(1))
    if (!id) return
    const doc = frame.value?.contentDocument
    const target =
      doc?.getElementById(id) ?? doc?.querySelector(`a[name="${CSS.escape(id)}"]`) ?? null
    target?.scrollIntoView({ behavior: 'smooth' })
    return
  }

  // External link → open in a new browser tab, leave the snapshot intact.
  e.preventDefault()
  if (/^https?:/i.test(anchor.href)) {
    window.open(anchor.href, '_blank', 'noopener,noreferrer')
  }
}

// Reload whenever the displayed document changes. immediate: true covers the initial mount.
watch(
  () => props.documentId,
  (id) => load(id),
  { immediate: true },
)

onBeforeUnmount(revoke)
</script>

<template>
  <div class="relative h-full w-full bg-white">
    <iframe
      ref="frame"
      title="Captured page"
      class="h-full w-full border-0"
      sandbox="allow-same-origin"
      @load="onFrameLoad"
    />

    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center bg-bg text-sm text-text-muted"
    >
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
