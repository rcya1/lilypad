<!-- Full-screen, touch-first search for the reader (/read/search, extension E3). Title matches come
     from the files store; full-text matches reuse the desktop `search` store (trigram index +
     snippets). It's a route, so the browser back button closes it. Renders its own app bar (back +
     input) — the shell hides its bar on this route. -->
<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, FileText, File, Globe, Image, Loader2, Search, X } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { useSearchStore, type SearchResult } from '@/stores/search'
import type { DocumentType } from '@/types/file-explorer'
import { ensureEntriesLoaded } from './context'

const router = useRouter()
const filesStore = useFilesStore()
const searchStore = useSearchStore()
const inputRef = useTemplateRef<HTMLInputElement>('input')

// Max title-match rows shown above the content matches.
const MAX_TITLE_RESULTS = 8

ensureEntriesLoaded()

onMounted(() => {
  document.title = 'Search · Lilypad'
  inputRef.value?.focus()
})

// The query lives in the shared search store, so returning here via back keeps it. If the index
// wasn't built yet when the query was typed (cold load), re-run once it is.
watch(
  () => filesStore.indexReady,
  (ready) => {
    if (ready && searchStore.query) searchStore.search(searchStore.query)
  },
)

const trimmedQuery = computed(() => searchStore.query.trim())

function displayName(name: string, type: DocumentType | null): string {
  return type === 'web' ? name : name.replace(/\.[^.]+$/, '')
}

interface TitleHit {
  id: string
  name: string
  type: DocumentType
  folderPath: string
}

// Notes whose name contains the query (any document type — pdf/web still open the placeholder).
const titleHits = computed<TitleHit[]>(() => {
  const q = trimmedQuery.value.toLowerCase()
  if (!q) return []
  const hits: TitleHit[] = []
  for (const e of filesStore.entries) {
    if (e.kind !== 'document' || !e.document_type) continue
    const name = displayName(e.name, e.document_type)
    if (!name.toLowerCase().includes(q)) continue
    hits.push({
      id: e.id,
      name,
      type: e.document_type,
      folderPath: filesStore.getFolderPath(e.id),
    })
  }
  // Prefix matches first, then alphabetical.
  hits.sort(
    (a, b) =>
      Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) ||
      a.name.localeCompare(b.name),
  )
  return hits.slice(0, MAX_TITLE_RESULTS)
})

// One row per note for content matches: the store returns up to 3 hits per file in rank order;
// a phone row shows the first snippet plus a count of the rest.
const contentHits = computed(() => {
  const groups = new Map<string, { first: SearchResult; count: number }>()
  for (const r of searchStore.results) {
    const g = groups.get(r.fileId)
    if (g) g.count++
    else groups.set(r.fileId, { first: r, count: 1 })
  }
  return [...groups.values()]
})

const hasResults = computed(() => titleHits.value.length > 0 || contentHits.value.length > 0)
const pending = computed(() => searchStore.isSearching || filesStore.loading)

function iconFor(type: DocumentType) {
  switch (type) {
    case 'image':
      return Image
    case 'web':
      return Globe
    case 'pdf':
      return File
    default:
      return FileText
  }
}

function onInput(e: Event) {
  searchStore.search((e.target as HTMLInputElement).value)
}

function clearQuery() {
  searchStore.search('')
  inputRef.value?.focus()
}

// Enter dismisses the on-screen keyboard so the results are visible.
function onEnter() {
  inputRef.value?.blur()
}

function close() {
  if ((window.history.state as { back?: string | null } | null)?.back) router.back()
  else router.push({ name: 'reader-browser' })
}

function open(id: string) {
  router.push({ name: 'reader-document', params: { entryId: id } })
}

function snippetParts(r: SearchResult) {
  return {
    before: r.snippet.slice(0, r.matchStart),
    match: r.snippet.slice(r.matchStart, r.matchStart + r.matchLength),
    after: r.snippet.slice(r.matchStart + r.matchLength),
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header
      class="shrink-0 border-b border-border-subtle bg-surface px-2 pt-[env(safe-area-inset-top)]"
    >
      <div class="flex h-14 items-center gap-1 pointer-fine:h-12">
        <button
          class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary active:bg-surface-overlay pointer-fine:h-9 pointer-fine:w-9"
          aria-label="Close search"
          @click="close"
        >
          <ArrowLeft :size="20" />
        </button>
        <div
          class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-subtle bg-bg px-3 focus-within:border-accent"
        >
          <Search :size="16" class="shrink-0 text-text-muted" />
          <!-- 16px text: anything smaller makes iOS Safari zoom the page on focus. -->
          <input
            ref="input"
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Search notes"
            aria-label="Search notes"
            class="min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
            :value="searchStore.query"
            @input="onInput"
            @keydown.enter="onEnter"
          />
          <Loader2
            v-if="pending && trimmedQuery"
            :size="16"
            class="shrink-0 animate-spin text-text-muted"
          />
        </div>
        <button
          v-if="searchStore.query"
          class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary active:bg-surface-overlay pointer-fine:h-9 pointer-fine:w-9"
          aria-label="Clear search"
          @click="clearQuery"
        >
          <X :size="20" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
      <!-- Empty query -->
      <div v-if="!trimmedQuery" class="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <Search :size="32" class="text-text-muted" />
        <h2 class="font-display text-xl text-text-secondary">Search your notes</h2>
        <p class="text-sm text-text-muted">Find notes by title or by anything written in them.</p>
      </div>

      <!-- No results (only once the debounced search has actually run) -->
      <div
        v-else-if="!hasResults && !pending"
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
      >
        <h2 class="font-display text-xl text-text-secondary">No matches</h2>
        <p class="break-all text-sm text-text-muted">
          {{ searchStore.regexError ?? `Nothing found for “${trimmedQuery}”.` }}
        </p>
      </div>

      <template v-else>
        <section v-if="titleHits.length" class="py-2">
          <h3 class="px-4 py-1 text-xs font-medium uppercase tracking-widest text-text-muted">
            Titles
          </h3>
          <button
            v-for="hit in titleHits"
            :key="hit.id"
            class="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-elevated active:bg-surface-overlay pointer-fine:min-h-9 pointer-fine:py-1.5"
            :class="hit.type === 'pdf' ? 'opacity-50' : ''"
            @click="open(hit.id)"
          >
            <component
              :is="iconFor(hit.type)"
              :size="18"
              class="shrink-0"
              :class="
                hit.type === 'md' || hit.type === 'web' ? 'text-text-secondary' : 'text-amber'
              "
            />
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm text-text-primary">{{ hit.name }}</span>
              <span v-if="hit.folderPath" class="truncate text-xs text-text-muted">
                {{ hit.folderPath }}
              </span>
            </span>
          </button>
        </section>

        <section v-if="contentHits.length" class="py-2">
          <h3 class="px-4 py-1 text-xs font-medium uppercase tracking-widest text-text-muted">
            In notes
          </h3>
          <button
            v-for="{ first, count } in contentHits"
            :key="first.fileId"
            class="flex min-h-11 w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-elevated active:bg-surface-overlay pointer-fine:py-2"
            @click="open(first.fileId)"
          >
            <FileText :size="18" class="mt-0.5 shrink-0 text-text-secondary" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-baseline gap-2">
                <span class="truncate text-sm text-text-primary">
                  {{ displayName(first.fileName, 'md') }}
                </span>
                <span v-if="first.folderPath" class="truncate text-xs text-text-muted">
                  {{ first.folderPath }}
                </span>
              </span>
              <span class="line-clamp-2 text-xs leading-relaxed break-words text-text-secondary">
                {{ snippetParts(first).before
                }}<mark
                  class="rounded-sm bg-surface-overlay px-0.5 font-medium text-text-primary"
                  >{{ snippetParts(first).match }}</mark
                >{{ snippetParts(first).after }}
              </span>
              <span v-if="count > 1" class="text-xs text-text-muted">
                +{{ count - 1 }} more {{ count - 1 === 1 ? 'match' : 'matches' }}
              </span>
            </span>
          </button>
        </section>
      </template>
    </div>
  </div>
</template>
