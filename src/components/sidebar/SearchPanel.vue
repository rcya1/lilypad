<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { Search, X, Loader2 } from 'lucide-vue-next'
import { useSearchStore } from '@/stores/search'
import { useFilesStore } from '@/stores/files'
import type { SearchResult } from '@/stores/search'

const searchStore = useSearchStore()
const filesStore = useFilesStore()
const inputRef = ref<HTMLInputElement | null>(null)

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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    searchStore.close()
  }
  // Alt+R: toggle regex
  if (e.altKey && e.key.toLowerCase() === 'r') {
    e.preventDefault()
    searchStore.toggleRegex()
  }
  // Alt+C: toggle case sensitivity
  if (e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    searchStore.toggleCaseSensitive()
  }
}

function clearSearch() {
  searchStore.search('')
}

// Group results by file
const groupedResults = computed(() => {
  const groups = new Map<
    string,
    { fileName: string; folderPath: string; results: SearchResult[] }
  >()
  for (const result of searchStore.results) {
    if (!groups.has(result.fileId)) {
      groups.set(result.fileId, {
        fileName: result.fileName,
        folderPath: result.folderPath,
        results: [],
      })
    }
    groups.get(result.fileId)!.results.push(result)
  }
  return [...groups.values()]
})

function snippetBefore(result: SearchResult): string {
  return result.snippet.slice(0, result.matchStart)
}

function snippetMatch(result: SearchResult): string {
  return result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)
}

function snippetAfter(result: SearchResult): string {
  return result.snippet.slice(result.matchStart + result.matchLength)
}

const isLoading = computed(() => filesStore.loading && !filesStore.indexReady)
</script>

<template>
  <div class="flex flex-col flex-1 overflow-hidden">
    <!-- Header -->
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

    <!-- Search input -->
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
        <!-- Toggle buttons + clear inside the input -->
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

    <!-- Loading spinner (index building) -->
    <div v-if="isLoading" class="flex items-center justify-center py-6">
      <Loader2 class="text-text-muted animate-spin" :size="16" />
    </div>

    <!-- Searching spinner (debounce) -->
    <div v-else-if="searchStore.isSearching" class="flex items-center justify-center py-6">
      <Loader2 class="text-text-muted animate-spin" :size="16" />
    </div>

    <!-- Regex error -->
    <div v-else-if="searchStore.regexError" class="px-3 py-6 text-center">
      <p class="text-xs text-red-500">Invalid regex</p>
    </div>

    <!-- Results -->
    <div v-else-if="groupedResults.length > 0" class="flex-1 overflow-y-auto">
      <div v-for="group in groupedResults" :key="group.fileName + group.folderPath" class="mb-1">
        <!-- File header -->
        <div class="px-3 pt-2 pb-0.5">
          <span class="text-xs font-medium text-text-secondary truncate block">
            {{ group.fileName }}
          </span>
          <span v-if="group.folderPath" class="text-xs text-text-muted truncate block">
            {{ group.folderPath }}
          </span>
        </div>

        <!-- Snippet rows -->
        <button
          v-for="result in group.results"
          :key="result.fileId + result.lineNumber"
          class="w-full text-left px-3 py-1 hover:bg-surface-elevated cursor-pointer transition-colors duration-75"
          @click="searchStore.openResult(result)"
        >
          <span class="text-xs font-mono text-text-muted leading-relaxed break-all">
            <span>{{ snippetBefore(result) }}</span>
            <span class="text-accent font-semibold">{{ snippetMatch(result) }}</span>
            <span>{{ snippetAfter(result) }}</span>
          </span>
        </button>
      </div>
    </div>

    <!-- No results -->
    <div v-else-if="searchStore.query && !searchStore.isSearching" class="px-3 py-6 text-center">
      <p class="text-xs text-text-muted">No results for "{{ searchStore.query }}"</p>
    </div>

    <!-- Prompt to type -->
    <div v-else-if="!searchStore.query" class="px-3 py-6 text-center">
      <p class="text-xs text-text-muted">Type to search across your notes</p>
    </div>
  </div>
</template>
