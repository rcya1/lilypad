import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useFilesStore } from './files'
import { useEditorStore } from './editor'

export interface SearchResult {
  fileId: string
  fileName: string
  folderPath: string
  lineNumber: number
  snippet: string
  matchStart: number
  matchLength: number
}

const DEBOUNCE_MS = 300
const MAX_RESULTS = 50
const MAX_PER_FILE = 3
const MIN_QUERY_LEN = 2
const SNIPPET_RADIUS = 40

function buildFolderPath(fileId: string, filesStore: ReturnType<typeof useFilesStore>): string {
  const entry = filesStore.entries.find((e) => e.id === fileId)
  if (!entry?.parent_id) return ''

  const segments: string[] = []
  let currentId: string | null = entry.parent_id
  while (currentId) {
    const parent = filesStore.entries.find((e) => e.id === currentId)
    if (!parent) break
    segments.unshift(parent.name)
    currentId = parent.parent_id
  }
  return segments.join(' / ')
}

function makeSnippet(
  line: string,
  matchIndex: number,
  queryLen: number,
): { snippet: string; matchStart: number } {
  const lineLen = line.length
  const center = matchIndex + Math.floor(queryLen / 2)
  const start = Math.max(0, center - SNIPPET_RADIUS)
  const end = Math.min(lineLen, center + SNIPPET_RADIUS)
  const snippet = (start > 0 ? '…' : '') + line.slice(start, end) + (end < lineLen ? '…' : '')
  const prefixLen = start > 0 ? 1 : 0 // account for ellipsis character
  const matchStart = Math.max(0, matchIndex - start + prefixLen)
  return { snippet, matchStart }
}

function searchContent(
  content: string,
  query: string,
  fileId: string,
  fileName: string,
  folderPath: string,
): SearchResult[] {
  const results: SearchResult[] = []
  const lower = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const lines = content.split('\n')
  let lineStart = 0

  for (let lineIdx = 0; lineIdx < lines.length && results.length < MAX_PER_FILE; lineIdx++) {
    const line = lines[lineIdx]!
    const lowerLine = line.toLowerCase()
    const localIdx = lowerLine.indexOf(lowerQuery)
    if (localIdx !== -1) {
      const { snippet, matchStart } = makeSnippet(line, localIdx, query.length)
      results.push({
        fileId,
        fileName,
        folderPath,
        lineNumber: lineIdx + 1,
        snippet,
        matchStart,
        matchLength: query.length,
      })
    }
    lineStart += (lines[lineIdx]?.length ?? 0) + 1
  }

  // Suppress unused variable warning — lineStart is only needed for the loop tracking
  void lower
  void lineStart

  return results
}

export const useSearchStore = defineStore('search', () => {
  const filesStore = useFilesStore()
  const editorStore = useEditorStore()

  const query = ref('')
  const results = ref<SearchResult[]>([])
  const isOpen = ref(false)
  const isSearching = ref(false)
  const hasUncachedFiles = ref(false)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  function runSearch(q: string) {
    isSearching.value = false

    if (q.length < MIN_QUERY_LEN) {
      results.value = []
      hasUncachedFiles.value = false
      return
    }

    const cachedEntries = filesStore.getCachedEntries()
    const allDocIds = filesStore.entries
      .filter((e) => e.kind === 'document' && e.document_type === 'md')
      .map((e) => e.id)

    hasUncachedFiles.value = allDocIds.some((id) => !cachedEntries.has(id))

    const found: SearchResult[] = []

    for (const [fileId, rawContent] of cachedEntries) {
      if (found.length >= MAX_RESULTS) break

      // Prefer live editor content for open tabs
      const openDoc = editorStore.openDocuments.get(fileId)
      const content = openDoc ? openDoc.content : rawContent

      const entryRow = filesStore.entries.find((e) => e.id === fileId)
      if (!entryRow || entryRow.kind !== 'document' || entryRow.document_type !== 'md') continue

      const fileName = entryRow.name
      const folderPath = buildFolderPath(fileId, filesStore)

      const fileResults = searchContent(content, q, fileId, fileName, folderPath)
      const remaining = MAX_RESULTS - found.length
      found.push(...fileResults.slice(0, remaining))
    }

    results.value = found
  }

  function search(q: string) {
    query.value = q
    if (debounceTimer !== null) clearTimeout(debounceTimer)

    if (q.length < MIN_QUERY_LEN) {
      results.value = []
      isSearching.value = false
      hasUncachedFiles.value = false
      return
    }

    isSearching.value = true
    debounceTimer = setTimeout(() => {
      runSearch(q)
    }, DEBOUNCE_MS)
  }

  async function openResult(result: SearchResult) {
    const entryRow = filesStore.entries.find((e) => e.id === result.fileId)
    if (!entryRow) return

    const type = (entryRow.document_type ?? 'md') as 'pdf' | 'md'

    if (!editorStore.openDocuments.has(result.fileId)) {
      editorStore.openDocumentOptimistic(result.fileId, result.fileName, type)
      const content = await filesStore.downloadContent(result.fileId)
      editorStore.finishLoadingDocument(result.fileId, content ?? '')
    } else {
      editorStore.setActiveDocument(result.fileId)
    }

    editorStore.requestScrollToLine(result.fileId, result.lineNumber)
    close()
  }

  return {
    query,
    results,
    isOpen,
    isSearching,
    hasUncachedFiles,
    open,
    close,
    toggle,
    search,
    openResult,
  }
})
