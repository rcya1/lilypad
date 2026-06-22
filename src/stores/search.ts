import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useFilesStore } from './files'
import { useEditorStore } from './editor'
import { findLiteralCandidates, findRegexCandidates } from '@/lib/trigram'

export interface SearchResult {
  fileId: string
  fileName: string
  folderPath: string
  lineNumber: number
  snippet: string
  matchStart: number
  matchLength: number
}

const DEBOUNCE_MS = 200
const MAX_RESULTS = 50
const MAX_PER_FILE = 3
const SNIPPET_RADIUS = 40

function makeSnippet(
  line: string,
  matchIndex: number,
  matchLen: number,
): { snippet: string; matchStart: number } {
  const lineLen = line.length
  const center = matchIndex + Math.floor(matchLen / 2)
  const start = Math.max(0, center - SNIPPET_RADIUS)
  const end = Math.min(lineLen, center + SNIPPET_RADIUS)
  const snippet = (start > 0 ? '…' : '') + line.slice(start, end) + (end < lineLen ? '…' : '')
  const prefixLen = start > 0 ? 1 : 0 // account for ellipsis character
  const matchStart = Math.max(0, matchIndex - start + prefixLen)
  return { snippet, matchStart }
}

// ---------------------------------------------------------------------------
// Literal search on a single file's content
// ---------------------------------------------------------------------------
function searchLiteral(
  content: string,
  query: string,
  caseSensitive: boolean,
  fileId: string,
  fileName: string,
  folderPath: string,
): SearchResult[] {
  const results: SearchResult[] = []
  const haystack = caseSensitive ? content : content.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const lines = content.split('\n')

  for (let lineIdx = 0; lineIdx < lines.length && results.length < MAX_PER_FILE; lineIdx++) {
    const line = lines[lineIdx]!
    const lowerLine = caseSensitive ? line : line.toLowerCase()
    const localIdx = lowerLine.indexOf(needle)
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
  }

  void haystack
  return results
}

// ---------------------------------------------------------------------------
// Regex search on a single file's content
// ---------------------------------------------------------------------------
function searchRegex(
  content: string,
  regex: RegExp,
  fileId: string,
  fileName: string,
  folderPath: string,
): SearchResult[] {
  const results: SearchResult[] = []
  const lines = content.split('\n')

  for (let lineIdx = 0; lineIdx < lines.length && results.length < MAX_PER_FILE; lineIdx++) {
    const line = lines[lineIdx]!
    const match = regex.exec(line)
    if (match) {
      const matchLen = match[0].length || 1 // avoid zero-length match display
      const { snippet, matchStart } = makeSnippet(line, match.index, matchLen)
      results.push({
        fileId,
        fileName,
        folderPath,
        lineNumber: lineIdx + 1,
        snippet,
        matchStart,
        matchLength: matchLen,
      })
    }
  }

  return results
}

export const useSearchStore = defineStore('search', () => {
  const filesStore = useFilesStore()
  const editorStore = useEditorStore()

  const query = ref('')
  const results = ref<SearchResult[]>([])
  const isOpen = ref(false)
  const isSearching = ref(false)
  const isRegex = ref(false)
  const isCaseSensitive = ref(false)
  const regexError = ref<string | null>(null)

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

  function toggleRegex() {
    isRegex.value = !isRegex.value
    // Re-run search with current query
    if (query.value) runSearch(query.value)
  }

  function toggleCaseSensitive() {
    isCaseSensitive.value = !isCaseSensitive.value
    if (query.value) runSearch(query.value)
  }

  // ---------------------------------------------------------------------------
  // Gather content for a file — prefer live editor content for open docs
  // ---------------------------------------------------------------------------
  function getFileContent(fileId: string): string | null {
    const openDoc = editorStore.openDocuments.get(fileId)
    if (openDoc) return openDoc.content
    return filesStore.getContentMap().get(fileId) ?? null
  }

  // ---------------------------------------------------------------------------
  // Core search
  // ---------------------------------------------------------------------------
  function runSearch(q: string) {
    isSearching.value = false
    regexError.value = null

    if (!q) {
      results.value = []
      return
    }

    const contentMap = filesStore.getContentMap()
    const trigramIdx = filesStore.getTrigramIndex()
    const found: SearchResult[] = []

    if (isRegex.value) {
      // -----------------------------------------------------------------------
      // Regex mode
      // -----------------------------------------------------------------------
      let regex: RegExp
      try {
        regex = new RegExp(q, isCaseSensitive.value ? 'g' : 'gi')
      } catch (e: unknown) {
        regexError.value = e instanceof Error ? e.message : 'Invalid regex'
        results.value = []
        return
      }

      // Trigram filtering for regex
      const candidates = findRegexCandidates(trigramIdx, q)
      const candidateIds = candidates ? candidates : new Set(contentMap.keys()) // full scan fallback

      // Also scan open editor docs (unsaved edits)
      const openDocIds = new Set(editorStore.openDocuments.keys())

      const allIds = new Set([...candidateIds, ...openDocIds])

      for (const fileId of allIds) {
        if (found.length >= MAX_RESULTS) break

        const content = getFileContent(fileId)
        if (content == null) continue

        const entryRow = filesStore.entries.find((e) => e.id === fileId)
        if (!entryRow || entryRow.kind !== 'document' || entryRow.document_type !== 'md') continue

        // Reset regex lastIndex for each file
        regex.lastIndex = 0

        const fileResults = searchRegex(
          content,
          regex,
          fileId,
          entryRow.name,
          filesStore.getFolderPath(fileId),
        )
        const remaining = MAX_RESULTS - found.length
        found.push(...fileResults.slice(0, remaining))
      }
    } else {
      // -----------------------------------------------------------------------
      // Literal mode
      // -----------------------------------------------------------------------
      const candidates = findLiteralCandidates(
        trigramIdx,
        isCaseSensitive.value ? q : q.toLowerCase(),
      )
      const candidateIds = candidates ? candidates : new Set(contentMap.keys()) // query < 3 chars → full scan

      // Also scan open editor docs (unsaved edits)
      const openDocIds = new Set(editorStore.openDocuments.keys())

      const allIds = new Set([...candidateIds, ...openDocIds])

      for (const fileId of allIds) {
        if (found.length >= MAX_RESULTS) break

        const content = getFileContent(fileId)
        if (content == null) continue

        const entryRow = filesStore.entries.find((e) => e.id === fileId)
        if (!entryRow || entryRow.kind !== 'document' || entryRow.document_type !== 'md') continue

        const fileResults = searchLiteral(
          content,
          q,
          isCaseSensitive.value,
          fileId,
          entryRow.name,
          filesStore.getFolderPath(fileId),
        )
        const remaining = MAX_RESULTS - found.length
        found.push(...fileResults.slice(0, remaining))
      }
    }

    results.value = found
  }

  function search(q: string) {
    query.value = q
    if (debounceTimer !== null) clearTimeout(debounceTimer)

    if (!q) {
      results.value = []
      isSearching.value = false
      regexError.value = null
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
    isRegex,
    isCaseSensitive,
    regexError,
    open,
    close,
    toggle,
    toggleRegex,
    toggleCaseSensitive,
    search,
    openResult,
  }
})
