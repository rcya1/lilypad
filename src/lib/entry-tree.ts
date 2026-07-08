// Pure helpers over flat EntryRow lists: tree building, ordering, ancestry walks.
import type { EntryRow } from '@/types/database'

/** Children of `parentId`, sorted by sort_order ascending then name as tiebreaker. */
export function sortedChildren(entries: EntryRow[], parentId: string | null): EntryRow[] {
  return entries
    .filter((e) => e.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

/**
 * Returns the next available sort_order for a new child of `parentId`.
 * Uses 1000-step increments so there's ample room for midpoint insertions
 * before renumbering is needed.
 */
export function getNextSortOrder(entries: EntryRow[], parentId: string | null): number {
  const siblings = entries.filter((e) => e.parent_id === parentId)
  if (siblings.length === 0) return 1000
  return Math.max(...siblings.map((e) => e.sort_order)) + 1000
}

/**
 * Returns `[id, ...all descendant ids]` via a depth-first walk of `entries`.
 * Used by `deleteEntry` and `moveEntry` (cycle detection).
 */
export function collectDescendantIds(entries: EntryRow[], id: string): string[] {
  const result = [id]
  const children = entries.filter((e) => e.parent_id === id)
  for (const child of children) {
    result.push(...collectDescendantIds(entries, child.id))
  }
  return result
}

/**
 * Filters `ids` down to entries whose ancestors are NOT also in `ids`.
 * Moving/deleting a folder already covers its descendants, so bulk operations
 * must act only on these "top-level" ids to avoid double-processing subtrees.
 */
export function filterTopLevelIds(byId: Map<string, EntryRow>, ids: Iterable<string>): string[] {
  const idSet = new Set(ids)
  return [...idSet].filter((id) => {
    let parentId = byId.get(id)?.parent_id ?? null
    while (parentId) {
      if (idSet.has(parentId)) return false
      parentId = byId.get(parentId)?.parent_id ?? null
    }
    return true
  })
}

/**
 * Returns true if `name` already exists among siblings under `parentId`.
 * Pass `excludeId` when renaming so the entry doesn't collide with itself.
 */
export function isDuplicateName(
  entries: EntryRow[],
  name: string,
  parentId: string | null,
  excludeId?: string,
): boolean {
  return entries.some((e) => e.parent_id === parentId && e.name === name && e.id !== excludeId)
}

/**
 * Returns a name that doesn't already exist among siblings in `parentId`.
 * Appends ` (2)`, ` (3)`, … to the base name (before the extension) until
 * the name is unique.
 */
export function deduplicateName(
  entries: EntryRow[],
  name: string,
  parentId: string | null,
): string {
  const siblings = new Set(entries.filter((e) => e.parent_id === parentId).map((e) => e.name))
  if (!siblings.has(name)) return name

  const dotIdx = name.lastIndexOf('.')
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name
  const ext = dotIdx > 0 ? name.slice(dotIdx) : ''
  let i = 2
  while (siblings.has(`${base} (${i})${ext}`)) i++
  return `${base} (${i})${ext}`
}
