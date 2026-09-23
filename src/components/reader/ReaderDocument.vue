<!-- One rendered note (the /read/:entryId view). Read-only: reuses parseMarkdownWithToc + the shared
     markdown-body typography so it matches the desktop preview exactly. md renders fully; image
     shows full-width; pdf/web get a "view on desktop" placeholder. -->
<script setup lang="ts">
import { ref, watch, inject, onBeforeUnmount, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { FileWarning, Monitor } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { parseMarkdownWithToc } from '@/lib/markdown'
import { readerKey } from './context'
import 'katex/dist/katex.min.css'
import '@/assets/markdown-body.css'

const props = defineProps<{ entryId: string }>()
const filesStore = useFilesStore()
const router = useRouter()
const reader = inject(readerKey)

type Status = 'loading' | 'md' | 'image' | 'placeholder' | 'notfound'
const status = ref<Status>('loading')
const html = ref('')
const wordCount = ref(0)
const placeholderKind = ref<'pdf' | 'web'>('pdf')
const scrollContainer = useTemplateRef<HTMLDivElement>('scrollContainer')

// Monotonic token so a slow load() whose entryId changed mid-await can't overwrite newer state.
let loadToken = 0

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function displayName(name: string): string {
  return name.replace(/\.md$/, '')
}

function scrollToHeading(id: string) {
  scrollContainer.value?.querySelector('#' + CSS.escape(id))?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

function resetContext() {
  if (!reader) return
  reader.toc = []
  reader.scrollToHeading = () => {}
}

async function load() {
  const token = ++loadToken
  status.value = 'loading'
  html.value = ''
  wordCount.value = 0
  resetContext()

  if (filesStore.entries.length === 0) await filesStore.fetchEntries()
  if (token !== loadToken) return

  const entry = filesStore.getEntry(props.entryId)
  if (!entry) {
    status.value = 'notfound'
    if (reader) reader.title = 'Not found'
    document.title = 'Not found · Lilypad'
    return
  }

  const name = displayName(entry.name)
  if (reader) reader.title = name
  document.title = `${name} · Lilypad`

  if (entry.document_type === 'md') {
    const content =
      filesStore.getCached(props.entryId) ?? (await filesStore.downloadContent(props.entryId))
    if (token !== loadToken) return
    const { html: rendered, toc } = parseMarkdownWithToc(content ?? '', (id) =>
      filesStore.getImageUrl(id),
    )
    html.value = rendered
    wordCount.value = countWords(content ?? '')
    if (reader) {
      reader.toc = toc
      reader.scrollToHeading = scrollToHeading
    }
    status.value = 'md'
  } else if (entry.document_type === 'image') {
    status.value = 'image'
  } else {
    placeholderKind.value = entry.document_type === 'web' ? 'web' : 'pdf'
    status.value = 'placeholder'
  }
}

// immediate: the component is reused across /read/a → /read/b, so re-run on entryId change.
watch(() => props.entryId, load, { immediate: true })

onBeforeUnmount(() => {
  if (reader) reader.title = ''
  resetContext()
})
</script>

<template>
  <div ref="scrollContainer" class="min-h-0 flex-1 overflow-y-auto bg-bg">
    <!-- Loading skeleton -->
    <div v-if="status === 'loading'" class="mx-auto max-w-[70ch] px-5 py-6">
      <div class="animate-pulse space-y-3">
        <div class="h-7 w-2/3 rounded bg-surface-elevated" />
        <div class="h-4 w-full rounded bg-surface-elevated" />
        <div class="h-4 w-11/12 rounded bg-surface-elevated" />
        <div class="h-4 w-5/6 rounded bg-surface-elevated" />
      </div>
    </div>

    <!-- Rendered markdown -->
    <template v-else-if="status === 'md'">
      <article
        class="markdown-body mx-auto max-w-[70ch] px-5 py-6 font-preview text-[16px] leading-[1.7] text-text-primary"
        v-html="html"
      />
      <div
        v-if="wordCount > 0"
        class="mx-auto max-w-[70ch] px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] text-right text-xs text-text-muted"
      >
        {{ wordCount.toLocaleString() }} words
      </div>
    </template>

    <!-- Image -->
    <div v-else-if="status === 'image'" class="px-4 py-6">
      <img
        :src="filesStore.getImageUrl(entryId) ?? undefined"
        :alt="reader?.title ?? ''"
        class="mx-auto max-w-full rounded"
      />
    </div>

    <!-- pdf / web placeholder -->
    <div
      v-else-if="status === 'placeholder'"
      class="flex flex-col items-center gap-3 px-6 py-24 text-center"
    >
      <Monitor :size="40" class="text-text-muted" />
      <p class="text-sm text-text-secondary">
        {{
          placeholderKind === 'web'
            ? 'Web pages open in the desktop app'
            : 'PDFs open in the desktop app'
        }}
      </p>
    </div>

    <!-- Not found -->
    <div v-else class="flex flex-col items-center gap-3 px-6 py-24 text-center">
      <FileWarning :size="40" class="text-text-muted" />
      <p class="text-sm text-text-secondary">Note not found</p>
      <button class="text-sm text-accent" @click="router.push({ name: 'reader-browser' })">
        Back to notes
      </button>
    </div>
  </div>
</template>
