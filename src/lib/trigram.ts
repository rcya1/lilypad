// Trigram index for client-side full-text search.

/** The inverted index: trigram → set of file IDs that contain it. */
export type TrigramIndex = Map<string, Set<string>>

/** Extract all 3-character substrings from lowercased text. */
export function extractTrigrams(text: string): Set<string> {
  const lower = text.toLowerCase()
  const trigrams = new Set<string>()
  for (let i = 0; i <= lower.length - 3; i++) {
    trigrams.add(lower.substring(i, i + 3))
  }
  return trigrams
}

/** Build the full trigram index from a content map. */
export function buildTrigramIndex(contentMap: Map<string, string>): TrigramIndex {
  const index: TrigramIndex = new Map()
  for (const [fileId, content] of contentMap) {
    for (const tri of extractTrigrams(content)) {
      let set = index.get(tri)
      if (!set) {
        set = new Set()
        index.set(tri, set)
      }
      set.add(fileId)
    }
  }
  return index
}

/** Remove a single file from the index. */
export function removeFileFromIndex(index: TrigramIndex, fileId: string): void {
  for (const [tri, set] of index) {
    set.delete(fileId)
    if (set.size === 0) index.delete(tri)
  }
}

/** Re-index a single file (remove old trigrams, add new ones). */
export function updateTrigramsForFile(index: TrigramIndex, fileId: string, content: string): void {
  removeFileFromIndex(index, fileId)
  for (const tri of extractTrigrams(content)) {
    let set = index.get(tri)
    if (!set) {
      set = new Set()
      index.set(tri, set)
    }
    set.add(fileId)
  }
}

/**
 * Find candidate file IDs for a literal (non-regex) query using the trigram
 * index.  Returns null if the query is too short for trigram filtering.
 */
export function findLiteralCandidates(index: TrigramIndex, query: string): Set<string> | null {
  const trigrams = extractTrigrams(query)
  if (trigrams.size === 0) return null // query < 3 chars

  let candidates: Set<string> | null = null
  for (const tri of trigrams) {
    const fileSet = index.get(tri)
    if (!fileSet) return new Set() // no file has this trigram → 0 results
    if (!candidates) {
      candidates = new Set(fileSet)
    } else {
      for (const id of candidates) {
        if (!fileSet.has(id)) candidates.delete(id)
      }
    }
  }
  return candidates ?? new Set()
}

/**
 * Extract maximal runs of literal characters from a regex pattern string.
 * Only runs of length ≥ 3 are returned (shorter runs can't form trigrams).
 */
export function extractLiteralRuns(pattern: string): string[] {
  const literals: string[] = []
  let current = ''
  let i = 0

  while (i < pattern.length) {
    const ch = pattern[i]

    // Escaped character
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1]!
      if (/[.*+?^${}()|[\]\\]/.test(next)) {
        current += next // escaped metachar is literal
        i += 2
        continue
      }
      // Shorthand class (\d \w \s etc.) breaks the literal run
      if (current.length >= 3) literals.push(current)
      current = ''
      i += 2
      continue
    }

    // Character class [...] — skip to closing bracket
    if (ch === '[') {
      if (current.length >= 3) literals.push(current)
      current = ''
      const close = pattern.indexOf(']', i + 1)
      i = close === -1 ? pattern.length : close + 1
      continue
    }

    // Metacharacter — breaks the run
    if (/[.*+?^${}()|[\]]/.test(ch!)) {
      if (current.length >= 3) literals.push(current)
      current = ''
      i++
      continue
    }

    current += ch
    i++
  }

  if (current.length >= 3) literals.push(current)
  return literals
}

/** Split a regex pattern on top-level unescaped `|` (alternation). */
export function splitOnTopLevelPipe(pattern: string): string[] {
  const branches: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === '|' && depth === 0) {
      branches.push(pattern.substring(start, i))
      start = i + 1
    }
  }
  branches.push(pattern.substring(start))
  return branches
}

/**
 * Find candidate file IDs for a regex pattern using trigram filtering.
 * Returns null when filtering can't help (full scan required).
 */
export function findRegexCandidates(index: TrigramIndex, pattern: string): Set<string> | null {
  const branches = splitOnTopLevelPipe(pattern)
  const branchCandidates: Set<string>[] = []

  for (const branch of branches) {
    const literals = extractLiteralRuns(branch)
    if (literals.length === 0) return null // branch matches anything → full scan

    const allTrigrams = literals.flatMap((lit) => [...extractTrigrams(lit)])

    let candidates: Set<string> | null = null
    for (const tri of allTrigrams) {
      const fileSet = index.get(tri)
      if (!fileSet) {
        candidates = new Set()
        break
      }
      if (!candidates) {
        candidates = new Set(fileSet)
      } else {
        for (const id of candidates) {
          if (!fileSet.has(id)) candidates.delete(id)
        }
      }
    }
    branchCandidates.push(candidates ?? new Set())
  }

  // Union across branches (alternation = OR)
  const result = new Set<string>()
  for (const set of branchCandidates) {
    for (const id of set) result.add(id)
  }
  return result
}
