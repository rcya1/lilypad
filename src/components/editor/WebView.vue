<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { useFilesStore } from '@/stores/files'

const props = defineProps<{ documentId: string }>()

const filesStore = useFilesStore()

const frame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
let blobUrl: string | null = null

function revoke() {
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl)
    blobUrl = null
  }
}

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
  // A blob: URL created here inherits this document's origin, so the parent can script into
  // the frame (link handling below; highlights in a later phase). Sandboxed without
  // allow-scripts, so the captured page itself stays inert.
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

watch(() => props.documentId, (id) => load(id), { immediate: true })

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
