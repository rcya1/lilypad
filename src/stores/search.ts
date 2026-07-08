// Pinia store for full-text search: debounced query dispatch, trigram-based candidate filtering, and snippet extraction.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useFilesStore } from './files'
import { useEditorStore } from './editor'
import { findLiteralCandidates, findRegexCandidates } from '@/lib/trigram'

/** A single search hit with enough context to render a result row and navigate to it. */
export interface SearchResult {
  fileId: string
  fileName: string
  folderPath: string
  lineNumber: number
  /** Truncated line text centred around the match, with leading/trailing '…' if clipped. */
  snippet: string
  /** Character offset of the match start within `snippet` (for highlight rendering). */
  matchStart: number
  matchLength: number
}

// How long to wait after the last keystroke before executing a search.
// Short enough to feel responsive, long enough not to spam on fast typists.
const DEBOUNCE_MS = 200
// Hard cap on total results across all files — prevents the UI from rendering
// hundreds of rows for very common search terms.
const MAX_RESULTS = 50
// Max hits shown per file — keeps results spread across more files.
const MAX_PER_FILE = 3
// Characters to show on each side of the match centre in a snippet.
const SNIPPET_RADIUS = 40

/**
 * Extracts a short snippet centred around a match within a line of text.
 *
 * @param line       - Full source line containing the match.
 * @param matchIndex - Character offset of the match start within `line`.
 * @param matchLen   - Length of the matched text.
 * @returns The truncated snippet string and the adjusted offset of the match within it.
 */
function makeSnippet(
  line: string,
  matchIndex: number,
  matchLen: number,
): { snippet: string; matchStart: number } {
  const lineLen = line.length
  // Centre the window on the middle of the match so both sides are visible.
  const center = matchIndex + Math.floor(matchLen / 2)
  const start = Math.max(0, center - SNIPPET_RADIUS)
  const end = Math.min(lineLen, center + SNIPPET_RADIUS)
  const snippet = (start > 0 ? '…' : '') + line.slice(start, end) + (end < lineLen ? '…' : '')
  // The ellipsis character is 1 char and shifts the match start when prepended.
  const prefixLen = start > 0 ? 1 : 0
  const matchStart = Math.max(0, matchIndex - start + prefixLen)
  return { snippet, matchStart }
}

/**
 * Finds up to MAX_PER_FILE literal matches in a single file's content.
 * Only returns the first match per line (uncommon to need multiple on one line).
 *
 * @param caseSensitive - When false, both haystack and needle are lowercased before comparison,
 *                        but `snippet` is always returned in original case.
 */
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

  // haystack is used for the case-insensitive check above; suppress unused-var lint.
  void haystack
  return results
}

/**
 * Finds up to MAX_PER_FILE regex matches in a single file's content.
 * Only the first match per line is recorded (same reasoning as searchLiteral).
 *
 * Precondition: `regex` must have the `g` flag set; callers must reset `lastIndex`
 * between files to avoid cross-file contamination from the stateful regex engine.
 *
 * @param regex - Compiled regex; caller controls the `i` flag for case sensitivity.
 */
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
      // Treat zero-length matches (e.g. lookaheads, `$`) as length 1 to keep the UI highlight visible.
      const matchLen = match[0].length || 1
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

  /** Toggles regex mode and immediately re-runs the current query if non-empty. */
  function toggleRegex() {
    isRegex.value = !isRegex.value
    if (query.value) runSearch(query.value)
  }

  /** Toggles case sensitivity and immediately re-runs the current query if non-empty. */
  function toggleCaseSensitive() {
    isCaseSensitive.value = !isCaseSensitive.value
    if (query.value) runSearch(query.value)
  }

  /**
   * Returns the most up-to-date content for a file.
   * Prefers the live editor buffer (which may have unsaved edits) over the persisted content map.
   */
  function getFileContent(fileId: string): string | null {
    const openDoc = editorStore.openDocuments.get(fileId)
    if (openDoc) return openDoc.content
    return filesStore.getContentMap().get(fileId) ?? null
  }

  /**
   * Executes a search synchronously against the in-memory content map.
   *
   * Strategy:
   *  1. Use the trigram index to narrow candidates to files likely containing `q`.
   *     Falls back to a full scan when `q` is fewer than 3 characters (too short for trigrams).
   *  2. Also include all currently open editor buffers in case they have unsaved edits
   *     not yet reflected in the trigram index.
   *  3. Linear scan each candidate file, collecting up to MAX_PER_FILE hits per file
   *     and stopping globally at MAX_RESULTS.
   *
   * Only searches markdown (`.md`) documents — PDFs, images, and web snapshots have
   * no indexable text content.
   */
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
      let regex: RegExp
      try {
        regex = new RegExp(q, isCaseSensitive.value ? 'g' : 'gi')
      } catch (e: unknown) {
        regexError.value = e instanceof Error ? e.message : 'Invalid regex'
        results.value = []
        return
      }

      // Trigram filtering for regex: extract literal prefix characters from the pattern.
      // Returns null when no literals can be extracted → full scan.
      const candidates = findRegexCandidates(trigramIdx, q)
      const candidateIds = candidates ? candidates : new Set(contentMap.keys())

      // Open editor buffers may have content not yet in the trigram index (unsaved edits).
      const openDocIds = new Set(editorStore.openDocuments.keys())
      const allIds = new Set([...candidateIds, ...openDocIds])

      for (const fileId of allIds) {
        if (found.length >= MAX_RESULTS) break

        const content = getFileContent(fileId)
        if (content == null) continue

        const entryRow = filesStore.entries.find((e) => e.id === fileId)
        if (!entryRow || entryRow.kind !== 'document' || entryRow.document_type !== 'md') continue

        // Reset lastIndex between files — the `g` flag makes exec() stateful.
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
      // Trigram literal search: lower-case the key to match how the index was built.
      const candidates = findLiteralCandidates(
        trigramIdx,
        isCaseSensitive.value ? q : q.toLowerCase(),
      )
      const candidateIds = candidates ? candidates : new Set(contentMap.keys())

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

  /**
   * Debounced entry point for search. Updates `query` immediately (so the input stays
   * reactive) and schedules runSearch after DEBOUNCE_MS of inactivity.
   *
   * `isSearching` is set to true during the debounce window so the UI can show a spinner.
   */
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

  /**
   * Opens the file for a search result and scrolls the editor to the matched line.
   * If the document is not already open, fetches its content first (optimistic tab open).
   * Closes the search panel after navigating.
   */
  async function openResult(result: SearchResult) {
    await editorStore.openEntry(result.fileId)
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
