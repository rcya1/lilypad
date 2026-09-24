<!-- One rendered note (the /read/:entryId view). Read-only: reuses parseMarkdownWithToc + the shared
     markdown-body typography so it matches the desktop preview exactly. md renders fully; image
     shows full-width; web shows the captured page + notes (ReaderWebDocument); pdf gets a "view on
     desktop" placeholder. -->
<script setup lang="ts">
import { ref, watch, inject, onBeforeUnmount, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { FileWarning, Monitor } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { parseMarkdownWithToc, type TocItem } from '@/lib/markdown'
import { readerKey, ensureEntriesLoaded } from './context'
import ReaderTocRail from './ReaderTocRail.vue'
import ReaderWebDocument from './ReaderWebDocument.vue'
import 'katex/dist/katex.min.css'
import '@/assets/markdown-body.css'

const props = defineProps<{ entryId: string }>()
const filesStore = useFilesStore()
const router = useRouter()
const reader = inject(readerKey)

type Status = 'loading' | 'md' | 'image' | 'web' | 'placeholder' | 'notfound'
const status = ref<Status>('loading')
const html = ref('')
const wordCount = ref(0)
const toc = ref<TocItem[]>([])
// Heading currently at the top of the viewport, highlighted in the wide-screen TOC rail.
const activeHeadingId = ref<string | null>(null)
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

// A heading counts as "current" once its top has scrolled within this many px of the container top.
const ACTIVE_HEADING_OFFSET = 32
let scrollFrame = 0

function updateActiveHeading() {
  scrollFrame = 0
  const container = scrollContainer.value
  if (!container || toc.value.length === 0) return
  const top = container.getBoundingClientRect().top + ACTIVE_HEADING_OFFSET
  let active: string | null = toc.value[0]!.id
  for (const item of toc.value) {
    const el = container.querySelector('#' + CSS.escape(item.id))
    if (!el) continue
    if (el.getBoundingClientRect().top > top) break
    active = item.id
  }
  activeHeadingId.value = active
}

function onScroll() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateActiveHeading)
}

function backToNotes() {
  router.push({ name: 'reader-browser' })
}

function resetContext() {
  if (!reader) return
  reader.toc = []
  reader.editable = false
  reader.scrollToHeading = () => {}
}

async function load() {
  const token = ++loadToken
  status.value = 'loading'
  html.value = ''
  wordCount.value = 0
  toc.value = []
  activeHeadingId.value = null
  resetContext()
  // The view is reused across /read/a → /read/b; start each note at the top.
  if (scrollContainer.value) scrollContainer.value.scrollTop = 0

  // Only await when the tree isn't loaded yet: with entries + cached content already in memory
  // (e.g. arriving from the editor) the note renders synchronously, with no skeleton frame.
  if (filesStore.entries.length === 0) {
    await ensureEntriesLoaded()
    if (token !== loadToken) return
  }

  const entry = filesStore.getEntry(props.entryId)
  // Folder ids are valid entries but not readable notes — treat them as not found.
  if (!entry || entry.kind !== 'document') {
    status.value = 'notfound'
    if (reader) reader.title = 'Not found'
    document.title = 'Not found · Lilypad'
    return
  }

  const name = displayName(entry.name)
  if (reader) {
    reader.title = name
    reader.editable = true
  }
  document.title = `${name} · Lilypad`

  if (entry.document_type === 'md') {
    const content =
      filesStore.getCached(props.entryId) ?? (await filesStore.downloadContent(props.entryId))
    if (token !== loadToken) return
    const { html: rendered, toc: headings } = parseMarkdownWithToc(content ?? '', (id) =>
      filesStore.getImageUrl(id),
    )
    html.value = rendered
    wordCount.value = countWords(content ?? '')
    toc.value = headings
    activeHeadingId.value = headings[0]?.id ?? null
    if (reader) {
      reader.toc = headings
      reader.scrollToHeading = scrollToHeading
    }
    status.value = 'md'
  } else if (entry.document_type === 'image') {
    status.value = 'image'
  } else if (entry.document_type === 'web') {
    status.value = 'web'
  } else {
    status.value = 'placeholder'
  }
}

// immediate: the component is reused across /read/a → /read/b, so re-run on entryId change.
watch(() => props.entryId, load, { immediate: true })

onBeforeUnmount(() => {
  if (reader) reader.title = ''
  resetContext()
  cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div ref="scrollContainer" class="min-h-0 flex-1 overflow-y-auto bg-bg" @scroll="onScroll">
    <!-- Loading skeleton -->
    <div v-if="status === 'loading'" class="mx-auto max-w-[70ch] px-4 py-4">
      <div class="animate-pulse space-y-3">
        <div class="h-7 w-2/3 rounded bg-surface-elevated" />
        <div class="h-4 w-full rounded bg-surface-elevated" />
        <div class="h-4 w-11/12 rounded bg-surface-elevated" />
        <div class="h-4 w-5/6 rounded bg-surface-elevated" />
      </div>
    </div>

    <!-- Rendered markdown -->
    <!-- Once the main column is ≥ 60rem (container query on ReaderShell's main column — the same
         threshold the shell uses to hide its TOC button): three columns, note in the middle, TOC
         rail in the left margin. The rail column has a floor so it never squeezes to nothing.
         font-preview on the grid so the 70ch middle column matches the article's own 70ch. -->
    <div
      v-else-if="status === 'md'"
      class="font-preview text-[16px] @min-[60rem]:grid @min-[60rem]:grid-cols-[minmax(14rem,1fr)_minmax(0,70ch)_minmax(0,1fr)]"
    >
      <aside
        v-if="toc.length"
        class="hidden font-ui @min-[60rem]:col-start-1 @min-[60rem]:row-start-1 @min-[60rem]:block"
      >
        <ReaderTocRail
          :toc="toc"
          :active-id="activeHeadingId"
          class="sticky top-0 max-h-[calc(100dvh-1.75rem)] ml-auto w-56 overflow-y-auto pr-8 pl-4"
          @select="scrollToHeading"
        />
      </aside>
      <div class="@min-[60rem]:col-start-2 @min-[60rem]:row-start-1">
        <!-- scroll-mt on headings: the scroll container already starts below the app bar, so this
             is just breathing room so a TOC jump doesn't pin the heading flush to the bar's edge. -->
        <article
          class="markdown-body mx-auto max-w-[70ch] px-4 py-4 font-preview motion-safe:animate-fade-in text-[16px] leading-[1.7] text-text-primary [&_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-4"
          v-html="html"
        />
        <div
          v-if="wordCount > 0"
          class="mx-auto max-w-[70ch] px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-right font-ui text-xs text-text-muted"
        >
          {{ wordCount.toLocaleString() }} words
        </div>
      </div>
    </div>

    <!-- Captured web page + notes -->
    <ReaderWebDocument v-else-if="status === 'web'" :key="entryId" :entry-id="entryId" />

    <!-- Image -->
    <div v-else-if="status === 'image'" class="px-4 py-4 motion-safe:animate-fade-up">
      <img
        :src="filesStore.getImageUrl(entryId) ?? undefined"
        :alt="reader?.title ?? ''"
        class="mx-auto max-w-full rounded"
      />
    </div>

    <!-- pdf placeholder -->
    <div
      v-else-if="status === 'placeholder'"
      class="flex flex-col items-center gap-3 px-6 py-16 text-center motion-safe:animate-fade-up"
    >
      <Monitor :size="40" class="text-text-muted" />
      <p class="text-sm text-text-secondary">PDFs open in the desktop app</p>
      <button
        class="min-h-11 rounded-lg px-4 text-sm text-accent transition-colors hover:bg-surface-elevated active:bg-surface-overlay pointer-fine:min-h-9"
        @click="backToNotes"
      >
        Back to notes
      </button>
    </div>

    <!-- Not found -->
    <div
      v-else
      class="flex flex-col items-center gap-3 px-6 py-16 text-center motion-safe:animate-fade-up"
    >
      <FileWarning :size="40" class="text-text-muted" />
      <p class="text-sm text-text-secondary">Note not found</p>
      <button
        class="min-h-11 rounded-lg px-4 text-sm text-accent transition-colors hover:bg-surface-elevated active:bg-surface-overlay pointer-fine:min-h-9"
        @click="backToNotes"
      >
        Back to notes
      </button>
    </div>
  </div>
</template>
