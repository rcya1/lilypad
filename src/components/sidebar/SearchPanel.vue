<!-- Sidebar search: regex and case toggles, results grouped by file. -->
<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { Search, X, Loader2, ChevronRight, FileText } from 'lucide-vue-next'
import { useSearchStore } from '@/stores/search'
import { useFilesStore } from '@/stores/files'
import type { SearchResult } from '@/stores/search'

const searchStore = useSearchStore()
const filesStore = useFilesStore()
const inputRef = ref<HTMLInputElement | null>(null)

// immediate: the panel can mount already open (e.g. after switching sidebar tabs).
watch(
  () => searchStore.isOpen,
  async (open) => {
    if (open) {
      await nextTick()
      inputRef.value?.focus()
    }
  },
  { immediate: true },
)

function onInput(e: Event) {
  searchStore.search((e.target as HTMLInputElement).value)
}

/** Escape closes; Alt+R toggles regex; Alt+C toggles case sensitivity. */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    searchStore.close()
  }
  if (e.altKey && e.key.toLowerCase() === 'r') {
    e.preventDefault()
    searchStore.toggleRegex()
  }
  if (e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    searchStore.toggleCaseSensitive()
  }
}

function clearSearch() {
  searchStore.search('')
}

/** Grouped by file, in the order the store returned them. */
const groupedResults = computed(() => {
  const groups = new Map<
    string,
    { fileId: string; fileName: string; folderPath: string; results: SearchResult[] }
  >()
  for (const result of searchStore.results) {
    if (!groups.has(result.fileId)) {
      groups.set(result.fileId, {
        fileId: result.fileId,
        fileName: result.fileName,
        folderPath: result.folderPath,
        results: [],
      })
    }
    groups.get(result.fileId)!.results.push(result)
  }
  return [...groups.values()]
})

const totalMatches = computed(() => searchStore.results.length)

// Collapsed files; reset for each new query.
const collapsedFiles = ref(new Set<string>())
watch(
  () => searchStore.query,
  () => (collapsedFiles.value = new Set()),
)
function toggleCollapse(fileId: string) {
  const next = new Set(collapsedFiles.value)
  if (next.has(fileId)) next.delete(fileId)
  else next.add(fileId)
  collapsedFiles.value = next
}

function snippetBefore(result: SearchResult): string {
  return result.snippet.slice(0, result.matchStart)
}

function snippetMatch(result: SearchResult): string {
  return result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)
}

function snippetAfter(result: SearchResult): string {
  return result.snippet.slice(result.matchStart + result.matchLength)
}

// Until the index is built, which can be after the entries arrive.
const isLoading = computed(() => filesStore.loading && !filesStore.indexReady)
</script>

<template>
  <div class="flex flex-col flex-1 overflow-hidden">
    <div class="flex items-center justify-between px-3 pt-1 pb-2">
      <span class="text-xs font-medium text-text-muted uppercase tracking-widest">Search</span>
      <button
        class="flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer"
        title="Close search"
        @click="searchStore.close()"
      >
        <X :size="14" />
      </button>
    </div>

    <div class="px-2 pb-2">
      <div class="relative flex items-center">
        <Search class="absolute left-2 text-text-muted pointer-events-none shrink-0" :size="13" />
        <input
          ref="inputRef"
          :value="searchStore.query"
          type="text"
          :placeholder="isLoading ? 'Loading search index…' : 'Search notes…'"
          :disabled="isLoading"
          class="w-full pl-7 pr-20 py-1.5 text-xs font-ui bg-bg border rounded text-text-primary placeholder:text-text-muted focus:outline-none transition-colors duration-100"
          :class="
            searchStore.regexError
              ? 'border-red-500 focus:border-red-500'
              : 'border-border focus:border-accent'
          "
          @input="onInput"
          @keydown="onKeydown"
        />
        <div class="absolute right-1.5 flex items-center gap-0.5">
          <button
            class="w-5 h-5 flex items-center justify-center rounded text-[11px] font-ui font-semibold leading-none transition-colors duration-100 cursor-pointer"
            :class="
              searchStore.isCaseSensitive
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-elevated'
            "
            title="Case sensitive (Alt+C)"
            @click="searchStore.toggleCaseSensitive()"
          >
            Aa
          </button>
          <button
            class="w-5 h-5 flex items-center justify-center rounded text-[11px] font-ui font-semibold leading-none transition-colors duration-100 cursor-pointer"
            :class="
              searchStore.isRegex
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-elevated'
            "
            title="Regex (Alt+R)"
            @click="searchStore.toggleRegex()"
          >
            .*
          </button>
          <button
            v-if="searchStore.query"
            class="text-text-muted hover:text-text-primary cursor-pointer ml-0.5"
            @click="clearSearch"
          >
            <X :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- Index still building -->
    <div v-if="isLoading" class="flex items-center justify-center py-6">
      <Loader2 class="text-text-muted animate-spin" :size="16" />
    </div>

    <!-- Waiting out the debounce -->
    <div v-else-if="searchStore.isSearching" class="flex items-center justify-center py-6">
      <Loader2 class="text-text-muted animate-spin" :size="16" />
    </div>

    <div v-else-if="searchStore.regexError" class="px-3 py-6 text-center">
      <p class="text-xs text-red-500">Invalid regex</p>
    </div>

    <div v-else-if="groupedResults.length > 0" class="flex flex-1 flex-col overflow-hidden">
      <div
        class="shrink-0 px-3 py-1.5 border-b border-border-subtle text-[11px] font-ui text-text-muted"
      >
        {{ totalMatches }} {{ totalMatches === 1 ? 'result' : 'results' }} in
        {{ groupedResults.length }} {{ groupedResults.length === 1 ? 'file' : 'files' }}
      </div>

      <div class="flex-1 overflow-y-auto py-1">
        <div v-for="group in groupedResults" :key="group.fileId" class="mb-0.5">
          <!-- File header: click to collapse its matches -->
          <button
            class="sticky top-0 z-10 flex w-full items-center gap-1 bg-surface px-2 py-1 text-left transition-colors duration-75 hover:bg-surface-elevated cursor-pointer"
            @click="toggleCollapse(group.fileId)"
          >
            <ChevronRight
              :size="12"
              class="shrink-0 text-text-muted transition-transform duration-100"
              :class="collapsedFiles.has(group.fileId) ? '' : 'rotate-90'"
            />
            <FileText :size="13" class="shrink-0 text-text-secondary" />
            <span class="truncate text-xs font-medium text-text-primary">{{ group.fileName }}</span>
            <span
              v-if="group.folderPath"
              class="truncate text-[10px] text-text-muted"
              :title="group.folderPath"
            >
              {{ group.folderPath }}
            </span>
            <span
              class="ml-auto shrink-0 rounded-full bg-surface-overlay px-1.5 text-[10px] font-medium tabular-nums text-text-secondary"
            >
              {{ group.results.length }}
            </span>
          </button>

          <template v-if="!collapsedFiles.has(group.fileId)">
            <button
              v-for="result in group.results"
              :key="result.fileId + result.lineNumber"
              class="flex w-full items-baseline gap-2 py-0.5 pl-3 pr-2 text-left transition-colors duration-75 hover:bg-surface-elevated cursor-pointer"
              @click="searchStore.openResult(result)"
            >
              <span
                class="w-6 shrink-0 text-right text-[10px] font-mono tabular-nums text-text-muted"
              >
                {{ result.lineNumber }}
              </span>
              <span class="text-xs font-ui leading-snug text-text-secondary break-words">
                <span>{{ snippetBefore(result) }}</span>
                <span class="rounded-sm bg-accent-subtle px-0.5 font-semibold text-accent">{{
                  snippetMatch(result)
                }}</span>
                <span>{{ snippetAfter(result) }}</span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>

    <div v-else-if="searchStore.query && !searchStore.isSearching" class="px-3 py-6 text-center">
      <p class="text-xs text-text-muted">No results for "{{ searchStore.query }}"</p>
    </div>

    <div v-else-if="!searchStore.query" class="px-3 py-6 text-center">
      <p class="text-xs text-text-muted">Type to search across your notes</p>
    </div>
  </div>
</template>
