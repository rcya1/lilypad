<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { FileText, File, Image } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import type { DocumentType } from '@/types/file-explorer'

const uiStore = useUiStore()
const filesStore = useFilesStore()
const editorStore = useEditorStore()

const MAX_RESULTS = 20

const query = ref('')
const highlightedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

interface FileItem {
  id: string
  name: string // full name, with extension
  displayName: string // extension stripped
  type: DocumentType
  folderPath: string
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function folderPathFor(id: string): string {
  return filesStore
    .getAncestorPath(id)
    .map((s) => s.name)
    .join(' / ')
}

/**
 * Fuzzy match: every char of `q` must appear in order in `name`.
 * Returns a score that rewards contiguous runs and matches near the start.
 */
function fuzzyScore(q: string, name: string): { matched: boolean; score: number } {
  let qi = 0
  let score = 0
  let prevMatch = -2
  for (let i = 0; i < name.length && qi < q.length; i++) {
    if (name[i] === q[qi]) {
      score += i === prevMatch + 1 ? 2 : 1 // contiguity bonus
      if (i === 0) score += 3 // start-of-string bonus
      prevMatch = i
      qi++
    }
  }
  return { matched: qi === q.length, score }
}

const allFiles = computed<FileItem[]>(() =>
  filesStore.entries
    .filter((e) => e.kind === 'document' && e.document_type != null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      displayName: stripExtension(e.name),
      type: e.document_type as DocumentType,
      folderPath: folderPathFor(e.id),
    })),
)

const results = computed<FileItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  const files = allFiles.value

  if (!q) {
    // Empty query: currently-open files first (tabOrder as recency hint), then the rest A→Z
    const openSet = new Set(editorStore.tabOrder)
    const openFiles = editorStore.tabOrder
      .map((id) => files.find((f) => f.id === id))
      .filter((f): f is FileItem => f != null)
    const rest = files
      .filter((f) => !openSet.has(f.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    return [...openFiles, ...rest].slice(0, MAX_RESULTS)
  }

  const scored: { file: FileItem; group: number; score: number }[] = []
  for (const file of files) {
    const base = file.displayName.toLowerCase()
    const { matched, score } = fuzzyScore(q, base)
    if (!matched) continue
    scored.push({ file, group: base.startsWith(q) ? 0 : 1, score })
  }
  scored.sort(
    (a, b) =>
      a.group - b.group ||
      b.score - a.score ||
      a.file.displayName.localeCompare(b.file.displayName),
  )
  return scored.slice(0, MAX_RESULTS).map((s) => s.file)
})

// Reset highlight whenever the result set changes
watch(results, () => {
  highlightedIndex.value = 0
})

// Focus + reset when the switcher opens
watch(
  () => uiStore.quickSwitcherOpen,
  async (open) => {
    if (open) {
      query.value = ''
      highlightedIndex.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

// Keep the highlighted row in view
watch(highlightedIndex, async () => {
  await nextTick()
  const row = listRef.value?.children[highlightedIndex.value] as HTMLElement | undefined
  row?.scrollIntoView({ block: 'nearest' })
})

function move(delta: number) {
  const len = results.value.length
  if (len === 0) return
  highlightedIndex.value = Math.min(len - 1, Math.max(0, highlightedIndex.value + delta))
}

async function openFile(item: FileItem) {
  uiStore.closeQuickSwitcher()
  const id = item.id

  if (editorStore.openDocuments.has(id)) {
    editorStore.setActiveDocument(id)
    return
  }

  if (item.type === 'image') {
    editorStore.openDocument(id, item.name, 'image', '')
    return
  }

  // md / pdf — load content, showing a skeleton while it arrives
  editorStore.openDocumentOptimistic(id, item.name, item.type)
  const content = await filesStore.downloadContent(id)
  editorStore.finishLoadingDocument(id, content ?? '')
}

function openHighlighted() {
  const item = results.value[highlightedIndex.value]
  if (item) openFile(item)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    openHighlighted()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    uiStore.closeQuickSwitcher()
  }
}
</script>

<template>
  <div
    v-if="uiStore.quickSwitcherOpen"
    class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30"
    @mousedown.self="uiStore.closeQuickSwitcher()"
  >
    <div class="max-w-lg w-full mx-4 bg-surface border border-border rounded-lg shadow-2xl overflow-hidden">
      <!-- Input -->
      <div class="p-2 border-b border-border-subtle">
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Go to file…"
          class="w-full px-3 py-2 text-sm font-ui bg-bg border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors duration-100"
          @keydown="onKeydown"
        />
      </div>

      <!-- Results -->
      <div v-if="results.length > 0" ref="listRef" class="max-h-80 overflow-y-auto py-1">
        <button
          v-for="(item, i) in results"
          :key="item.id"
          class="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-75 cursor-pointer"
          :class="i === highlightedIndex ? 'bg-surface-elevated' : 'hover:bg-surface-elevated/60'"
          @mousemove="highlightedIndex = i"
          @click="openFile(item)"
        >
          <span class="flex items-center shrink-0">
            <File v-if="item.type === 'pdf'" :size="15" class="text-amber" />
            <Image v-else-if="item.type === 'image'" :size="15" class="text-text-muted" />
            <FileText v-else :size="15" class="text-text-secondary" />
          </span>
          <span class="text-sm text-text-primary truncate">{{ item.displayName }}</span>
          <span class="ml-auto pl-3 text-xs text-text-muted truncate shrink-0 max-w-[45%]">
            {{ item.folderPath }}
          </span>
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="query" class="px-3 py-6 text-center">
        <p class="text-sm text-text-muted">No files match</p>
      </div>
    </div>
  </div>
</template>
