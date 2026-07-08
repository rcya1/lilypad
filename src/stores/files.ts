// Pinia store for all file-system state: entry tree, CRUD, drag-drop ordering, in-memory content, trigram search index, image uploads, and web captures.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { captureWebPage } from '@/lib/webCapture'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import type { EntryRow } from '@/types/database'
import type { Entry, DocumentType } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import {
  buildTrigramIndex as buildIndex,
  updateTrigramsForFile,
  removeFileFromIndex,
  type TrigramIndex,
} from '@/lib/trigram'

// ---------------------------------------------------------------------------
// Module-level singletons shared across all store instances.
// These live outside the store so they survive hot-reloads without a full
// refetch, and so the search store can access them without going through Vue
// reactivity (the Map is too large to make reactive).
//
// contentMap: id → full text of every .md and web-doc notes column.
//   No eviction. Typical usage: 200 files × 5 KB ≈ 1 MB — well within budget.
//   Populated on fetchEntries; kept in sync by uploadContent / deleteEntry.
//
// trigramIndex: 3-char substring → Set<fileId>. Rebuilt from contentMap on
//   startup; incrementally updated by uploadContent / deleteEntry.
// ---------------------------------------------------------------------------
const contentMap = new Map<string, string>()
const trigramIndex: TrigramIndex = new Map()

export const useFilesStore = defineStore('files', () => {
  const auth = useAuthStore()
  const toast = useToastStore()

  // All entry rows fetched from Supabase for the authenticated user.
  const entries = ref<EntryRow[]>([])
  const loading = ref(false)

  // The folder the user explicitly navigated into (used as default parent for new files).
  const selectedFolderId = ref<string | null>(null)

  // IDs of folders whose children are hidden in the file explorer.
  const collapsedFolderIds = ref(new Set<string>())

  // IDs of entries checked via multi-select (checkbox or Shift+click).
  const selectedIds = ref(new Set<string>())

  // The most recently clicked entry — anchor for Shift+click range selection.
  const lastClickedId = ref<string | null>(null)

  /**
   * Pending inline-creation state. When non-null, the file explorer renders a
   * PendingInputRow at the specified position so the user can type a name.
   * `insertBefore: null` appends at the end of the parent's children.
   */
  const pendingCreate = ref<{
    parentId: string | null
    type: 'file' | 'folder'
    insertBefore: string | null
  } | null>(null)

  /** True once the trigram index has been built after the initial fetch. Blocks search until ready. */
  const indexReady = ref(false)

  /** O(1) id → row lookup, recomputed whenever `entries` changes. */
  const entryById = computed(() => {
    const map = new Map<string, EntryRow>()
    for (const e of entries.value) map.set(e.id, e)
    return map
  })

  // Derived file tree excluding image entries (images live in imageTree).
  const tree = computed<Entry[]>(() => buildTree(null))

  // Parallel tree containing only images and the folders that contain them.
  const imageTree = computed<Entry[]>(() => buildImageTree(null))

  /**
   * Returns true if `name` already exists among siblings under `parentId`.
   * Pass `excludeId` when renaming so the entry doesn't collide with itself.
   */
  function isDuplicateName(name: string, parentId: string | null, excludeId?: string): boolean {
    return entries.value.some(
      (e) => e.parent_id === parentId && e.name === name && e.id !== excludeId,
    )
  }

  function showError(msg: string) {
    toast.addToast(msg, 'error')
  }

  /**
   * Recursively builds the navigable file tree rooted at `parentId`.
   * Images are excluded here — they appear only in `imageTree`.
   * Sort order: sort_order ascending, then name alphabetically as tiebreaker.
   */
  function buildTree(parentId: string | null): Entry[] {
    const children = entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

    return children
      .filter((row) => row.document_type !== 'image')
      .map((row) => {
        if (row.kind === 'directory') {
          return {
            kind: 'directory' as const,
            id: row.id,
            name: row.name,
            parentId: row.parent_id,
            children: buildTree(row.id),
          }
        }
        return {
          kind: 'document' as const,
          id: row.id,
          name: row.name,
          parentId: row.parent_id,
          type: row.document_type as DocumentType,
        }
      })
  }

  /**
   * Like buildTree but filters to image documents and the folders that contain
   * them (directly or transitively). Folders with no image descendants are
   * excluded — the images tab only shows relevant structure.
   */
  function buildImageTree(parentId: string | null): Entry[] {
    const children = entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

    return children
      .filter((row) => row.document_type === 'image' || row.kind === 'directory')
      .map((row) => {
        if (row.kind === 'directory') {
          return {
            kind: 'directory' as const,
            id: row.id,
            name: row.name,
            parentId: row.parent_id,
            children: buildImageTree(row.id),
          }
        }
        return {
          kind: 'document' as const,
          id: row.id,
          name: row.name,
          parentId: row.parent_id,
          type: row.document_type as DocumentType,
        }
      })
  }

  /**
   * Returns the next available sort_order for a new child of `parentId`.
   * Uses 1000-step increments so there's ample room for midpoint insertions
   * before renumbering is needed.
   */
  function getNextSortOrder(parentId: string | null): number {
    const siblings = entries.value.filter((e) => e.parent_id === parentId)
    if (siblings.length === 0) return 1000
    return Math.max(...siblings.map((e) => e.sort_order)) + 1000
  }

  /**
   * Returns the sort_order to assign to the entry being created inline.
   * When `insertBefore` is set, uses the midpoint between the preceding
   * sibling's sort_order and the target's sort_order (fractional bisection).
   * Falls back to appending at the end when no `insertBefore` is specified.
   *
   * Precondition: `pendingCreate.value` must be non-null.
   */
  function getPendingSortOrder(): number {
    if (!pendingCreate.value) return 1000
    const { parentId, insertBefore } = pendingCreate.value
    if (!insertBefore) return getNextSortOrder(parentId)
    const siblings = entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const idx = siblings.findIndex((s) => s.id === insertBefore)
    if (idx === -1) return getNextSortOrder(parentId)
    const cur = siblings[idx]!.sort_order
    // If inserting at position 0, use cur - 1000 as a synthetic previous order.
    const prevOrder = idx > 0 ? siblings[idx - 1]!.sort_order : cur - 1000
    return (prevOrder + cur) / 2
  }

  function selectFolder(id: string | null) {
    selectedFolderId.value = id
  }

  function isFolderCollapsed(id: string): boolean {
    return collapsedFolderIds.value.has(id)
  }

  /**
   * Replacing the Set rather than mutating in-place ensures Vue reactivity
   * tracks the change (Vue 3 can detect Set.add/delete on reactive Sets, but
   * creating a new Set guarantees watchers fire consistently).
   */
  function expandFolder(id: string) {
    const next = new Set(collapsedFolderIds.value)
    next.delete(id)
    collapsedFolderIds.value = next
  }

  function collapseFolder(id: string) {
    const next = new Set(collapsedFolderIds.value)
    next.add(id)
    collapsedFolderIds.value = next
  }

  function collapseAll() {
    const allFolderIds = entries.value.filter((e) => e.kind === 'directory').map((e) => e.id)
    collapsedFolderIds.value = new Set(allFolderIds)
  }

  function expandAll() {
    collapsedFolderIds.value = new Set()
  }

  /**
   * Toggles the check state of a single entry.
   * Always updates `lastClickedId` so a subsequent Shift+click can anchor from here.
   */
  function toggleSelection(id: string) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    lastClickedId.value = id
  }

  /** Replaces the current selection with the given set of IDs (used after range selection). */
  function setSelection(ids: string[]) {
    selectedIds.value = new Set(ids)
  }

  /** Selects exactly one entry and makes it the range anchor. */
  function selectSingle(id: string) {
    selectedIds.value = new Set([id])
    lastClickedId.value = id
  }

  function clearSelection() {
    selectedIds.value = new Set()
    lastClickedId.value = null
  }

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id)
  }

  /**
   * Returns an ordered flat list of all visible entry IDs, respecting the
   * current collapsed state of folders. Used as the ordered index for
   * Shift+click range selection.
   */
  function getFlatVisibleEntryIds(): string[] {
    const result: string[] = []
    function walk(nodes: Entry[]) {
      for (const node of nodes) {
        result.push(node.id)
        if (isDirectory(node) && !collapsedFolderIds.value.has(node.id)) {
          walk(node.children)
        }
      }
    }
    walk(tree.value)
    return result
  }

  /**
   * Shift+click: selects all entries between `lastClickedId` and `id` in
   * visible order. Falls back to a plain toggle when `lastClickedId` is unset
   * or either ID isn't currently visible (e.g. inside a collapsed folder).
   */
  function rangeSelectTo(id: string) {
    const flat = getFlatVisibleEntryIds()
    const lastId = lastClickedId.value
    if (!lastId) {
      toggleSelection(id)
      return
    }
    const a = flat.indexOf(lastId)
    const b = flat.indexOf(id)
    if (a === -1 || b === -1) {
      toggleSelection(id)
      return
    }
    const [from, to] = a < b ? [a, b] : [b, a]
    setSelection(flat.slice(from, to + 1))
  }

  /**
   * Walks up the ancestor chain of `id` and returns the first ancestor whose
   * ID is in `selectedIds`, or null if none exists.
   * Used by `explodeAndToggle` to detect when the user is clicking inside a
   * selected folder.
   */
  function findSelectedAncestor(id: string): string | null {
    let parentId = entryById.value.get(id)?.parent_id ?? null
    while (parentId) {
      if (selectedIds.value.has(parentId)) return parentId
      parentId = entryById.value.get(parentId)?.parent_id ?? null
    }
    return null
  }

  /**
   * Handles clicking a child of an already-selected folder.
   *
   * When a folder is selected and the user clicks one of its children, it's
   * ambiguous whether they want to add the child to the selection or "enter"
   * the folder and select individual children. This resolves it by "exploding"
   * the folder: replace the folder selection with all its direct siblings
   * (excluding the clicked item), then toggle the clicked item normally.
   *
   * If no selected ancestor is found, falls through to a plain toggle.
   */
  function explodeAndToggle(id: string) {
    const ancestorId = findSelectedAncestor(id)
    if (!ancestorId) {
      toggleSelection(id)
      return
    }
    const next = new Set(selectedIds.value)
    next.delete(ancestorId)
    const siblings = entries.value.filter((e) => e.parent_id === ancestorId)
    for (const sibling of siblings) {
      if (sibling.id !== id) next.add(sibling.id)
    }
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    lastClickedId.value = id
  }

  /**
   * Deletes all entries in `ids`, but skips any entry whose ancestor is also
   * in `ids` (avoids double-deleting already-deleted descendants).
   *
   * @returns true if every delete succeeded.
   */
  async function bulkDelete(ids: string[]): Promise<boolean> {
    const idSet = new Set(ids)
    // Only delete top-level entries in the selection — descendants will be
    // removed by the recursive deleteEntry cascade.
    const topLevel = ids.filter((id) => {
      let parentId = entryById.value.get(id)?.parent_id ?? null
      while (parentId) {
        if (idSet.has(parentId)) return false
        parentId = entryById.value.get(parentId)?.parent_id ?? null
      }
      return true
    })
    const results = await Promise.all(topLevel.map((id) => deleteEntry(id)))
    clearSelection()
    return results.every(Boolean)
  }

  /**
   * Moves all `ids` into `targetFolderId`, assigning consecutive sort_orders
   * starting at `getNextSortOrder(targetFolderId)` to preserve relative order.
   *
   * @returns true if every move succeeded.
   */
  async function bulkMove(ids: string[], targetFolderId: string | null): Promise<boolean> {
    const base = getNextSortOrder(targetFolderId)
    // Sequential (not Promise.all): each moveEntry renumbers siblings in the target folder,
    // and concurrent renumber passes would interleave writes against mutating local state.
    let allOk = true
    for (let i = 0; i < ids.length; i++) {
      const ok = await moveEntry(ids[i]!, targetFolderId, base + i * 1000, true)
      if (!ok) allOk = false
    }
    clearSelection()
    return allOk
  }

  /**
   * Returns the parent folder ID of a file, or null if the file is at the root
   * or the ID is not found.
   */
  function getParentFolderId(fileId: string): string | null {
    const entry = entryById.value.get(fileId)
    return entry?.parent_id ?? null
  }

  /**
   * Returns the ordered list of ancestor directories from root to immediate
   * parent for the given file id.
   */
  function getAncestorPath(fileId: string): { id: string; name: string }[] {
    const entry = entryById.value.get(fileId)
    if (!entry?.parent_id) return []
    const segments: { id: string; name: string }[] = []
    let currentId: string | null = entry.parent_id
    while (currentId) {
      const parent = entryById.value.get(currentId)
      if (!parent) break
      // Prepend so the array is root-first.
      segments.unshift({ id: parent.id, name: parent.name })
      currentId = parent.parent_id
    }
    return segments
  }

  /**
   * Human-readable folder path string for a file, e.g. "Notes / Math".
   * Returns an empty string for root-level files.
   */
  function getFolderPath(fileId: string): string {
    return getAncestorPath(fileId)
      .map((segment) => segment.name)
      .join(' / ')
  }

  /**
   * Programmatic entry point for starting an inline file creation (used by the
   * global Ctrl+N shortcut). Mirrors the parent-priority logic in FileExplorer:
   * selectedFolderId → parent of the active tab → root.
   */
  function beginCreate(kind: 'document' | 'folder', parentId: string | null) {
    triggerCreate(parentId, kind === 'document' ? 'file' : 'folder')
  }

  /**
   * Sets `pendingCreate` to show the inline creation row in the file explorer.
   *
   * @param insertBefore - ID of the sibling to insert before; null appends at end.
   */
  function triggerCreate(
    parentId: string | null,
    type: 'file' | 'folder',
    insertBefore: string | null = null,
  ) {
    pendingCreate.value = { parentId, type, insertBefore }
  }

  /**
   * Updates the pending creation position (e.g. when the drag target changes
   * while the input row is visible).
   *
   * Precondition: `pendingCreate.value` must be non-null; no-ops otherwise.
   */
  function updatePendingPosition(parentId: string | null, insertBefore: string | null) {
    if (!pendingCreate.value) return
    pendingCreate.value = { ...pendingCreate.value, parentId, insertBefore }
  }

  function clearPendingCreate() {
    pendingCreate.value = null
  }

  // ---------------------------------------------------------------------------
  // Content map & trigram index helpers
  // ---------------------------------------------------------------------------

  /**
   * Populates `contentMap` from the already-fetched `entries`.
   * Only `.md` and `web` entries store their content in the DB `content` column;
   * binary files (PDF, image) use Storage and are excluded here.
   *
   * Called once after `fetchEntries` completes.
   */
  function populateContentMap(): void {
    contentMap.clear()
    for (const entry of entries.value) {
      if (
        (entry.document_type === 'md' || entry.document_type === 'web') &&
        entry.content != null
      ) {
        contentMap.set(entry.id, entry.content)
      }
    }
  }

  /**
   * Clears and rebuilds the trigram index from the current `contentMap`.
   * Sets `indexReady` to true when done, unblocking the search store.
   *
   * Called once after `populateContentMap` during startup.
   */
  function rebuildTrigramIndex(): void {
    trigramIndex.clear()
    const built = buildIndex(contentMap)
    for (const [tri, set] of built) {
      trigramIndex.set(tri, set)
    }
    indexReady.value = true
  }

  // ---------------------------------------------------------------------------
  // CRUD operations
  // ---------------------------------------------------------------------------

  /**
   * Fetches all entries for the authenticated user from Supabase, then
   * populates the in-memory content map and rebuilds the trigram index.
   *
   * Precondition: `auth.user` must be set. No-ops if not authenticated.
   * Postcondition: `entries`, `contentMap`, `trigramIndex`, and `indexReady`
   *   are all updated atomically from the caller's perspective.
   */
  async function fetchEntries() {
    if (!auth.user) return
    loading.value = true
    // Block search while we're rebuilding.
    indexReady.value = false

    const { data, error: err } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('sort_order')
      .returns<EntryRow[]>()

    if (err) {
      showError('Failed to load files.')
    } else {
      entries.value = data ?? []
      populateContentMap()
      rebuildTrigramIndex()
    }
    loading.value = false
  }

  /**
   * Creates a new document entry in Supabase and adds it to the local state.
   *
   * For `.md` documents: content lives in the DB `content` column, initialized
   * to an empty string. The entry is also added to `contentMap`.
   *
   * For binary types (PDF, image): an empty placeholder blob is uploaded to
   * Storage so the `storage_path` is valid immediately.
   *
   * @param sortOrder - When provided, the entry is inserted at that position
   *   and `renumberSiblings` is called to keep sort_orders clean.
   * @returns The created `EntryRow`, or null on failure/duplicate name.
   */
  async function createDocument(
    name: string,
    type: DocumentType,
    parentId: string | null = null,
    sortOrder?: number,
  ) {
    if (!auth.user) return null

    if (isDuplicateName(name, parentId)) {
      showError('A file with that name already exists in this location.')
      return null
    }

    const isMd = type === 'md'

    const { data, error: err } = await supabase
      .from('entries')
      .insert({
        user_id: auth.user.id,
        kind: 'document' as const,
        name,
        document_type: type,
        parent_id: parentId,
        sort_order: sortOrder ?? getNextSortOrder(parentId),
        // Only seed `content` for .md; other types use Storage.
        ...(isMd ? { content: '' } : {}),
      })
      .select()
      .returns<EntryRow[]>()
      .single()

    if (err || !data) {
      showError('Failed to create file.')
      return null
    }

    if (!isMd) {
      // Create an empty Storage placeholder so storage_path is immediately valid.
      const ext = type === 'pdf' ? 'pdf' : type
      const storagePath = `${auth.user.id}/${data.id}.${ext}`

      await supabase.storage
        .from('user-files')
        .upload(storagePath, new Blob([''], { type: 'text/plain' }))

      await supabase.from('entries').update({ storage_path: storagePath }).eq('id', data.id)

      data.storage_path = storagePath
    } else {
      contentMap.set(data.id, '')
      // Empty string has no trigrams; index is unchanged.
    }

    entries.value.push(data)
    // renumberSiblings keeps sort_orders clean after a midpoint insertion.
    if (sortOrder != null) renumberSiblings(parentId)
    return data
  }

  /**
   * Creates a new directory entry.
   *
   * @returns The created `EntryRow`, or null on failure/duplicate name.
   */
  async function createDirectory(name: string, parentId: string | null = null, sortOrder?: number) {
    if (!auth.user) return null

    if (isDuplicateName(name, parentId)) {
      showError('A folder with that name already exists in this location.')
      return null
    }

    const { data, error: err } = await supabase
      .from('entries')
      .insert({
        user_id: auth.user.id,
        kind: 'directory' as const,
        name,
        parent_id: parentId,
        sort_order: sortOrder ?? getNextSortOrder(parentId),
      })
      .select()
      .returns<EntryRow[]>()
      .single()

    if (err || !data) {
      showError('Failed to create folder.')
      return null
    }

    entries.value.push(data)
    if (sortOrder != null) renumberSiblings(parentId)
    return data
  }

  /**
   * Renames an entry, checking for sibling name collisions first.
   *
   * @returns true on success, false if the rename was rejected or failed.
   */
  async function renameEntry(id: string, newName: string) {
    const entry = entryById.value.get(id)
    if (entry && isDuplicateName(newName, entry.parent_id, id)) {
      showError('A file or folder with that name already exists in this location.')
      return false
    }

    const { error: err } = await supabase.from('entries').update({ name: newName }).eq('id', id)

    if (err) {
      showError('Failed to rename entry.')
      return false
    }

    // Mutate in-place — the row reference is shared with `entries.value`.
    if (entry) entry.name = newName
    return true
  }

  /**
   * Deletes an entry and all its descendants (files + folders recursively).
   *
   * Supabase's `ON DELETE CASCADE` handles DB child rows; we still need to
   * manually remove Storage objects for any binary files in the subtree.
   *
   * Postcondition: All descendant IDs are removed from `entries`, `contentMap`,
   *   and `trigramIndex`.
   *
   * @returns true on success, false if the Supabase delete failed.
   */
  async function deleteEntry(id: string) {
    const idsToDelete = collectDescendantIds(id)

    // Remove Storage blobs for binary files in the subtree.
    const storagePaths = idsToDelete
      .map((did) => entryById.value.get(did))
      .filter((e) => e?.storage_path)
      .map((e) => e!.storage_path!)

    if (storagePaths.length > 0) {
      await supabase.storage.from('user-files').remove(storagePaths)
    }

    // Deleting the root triggers DB cascade for all descendants.
    const { error: err } = await supabase.from('entries').delete().eq('id', id)

    if (err) {
      showError('Failed to delete entry.')
      return false
    }

    entries.value = entries.value.filter((e) => !idsToDelete.includes(e.id))

    // Sync content map and trigram index.
    for (const did of idsToDelete) {
      if (contentMap.has(did)) {
        contentMap.delete(did)
        removeFileFromIndex(trigramIndex, did)
      }
    }

    if (selectedFolderId.value && idsToDelete.includes(selectedFolderId.value)) {
      selectedFolderId.value = null
    }

    return true
  }

  /**
   * Returns `[id, ...all descendant ids]` via a depth-first walk of `entries`.
   * Used by `deleteEntry` and `moveEntry` (cycle detection).
   */
  function collectDescendantIds(id: string): string[] {
    const result = [id]
    const children = entries.value.filter((e) => e.parent_id === id)
    for (const child of children) {
      result.push(...collectDescendantIds(child.id))
    }
    return result
  }

  /**
   * Moves an entry to a new parent and sort position.
   *
   * @param silent - When true, suppresses error toasts (used during bulk moves
   *   where the caller surfaces aggregate errors).
   * @returns false immediately if the move would create a folder cycle
   *   (target is a descendant of the entry being moved).
   *
   * Precondition: `newParentId` must not be in `collectDescendantIds(id)`.
   * Postcondition: Siblings in `newParentId` are renumbered to keep sort_orders
   *   as clean multiples of 1000.
   */
  async function moveEntry(
    id: string,
    newParentId: string | null,
    newSortOrder: number,
    silent = false,
  ): Promise<boolean> {
    // Cycle guard: can't move a folder into one of its own descendants.
    const descendants = collectDescendantIds(id)
    if (newParentId !== null && descendants.includes(newParentId)) return false

    const moving = entryById.value.get(id)
    if (moving && isDuplicateName(moving.name, newParentId, id)) {
      if (!silent) showError('A file or folder with that name already exists in that location.')
      return false
    }

    const { error: err } = await supabase
      .from('entries')
      .update({ parent_id: newParentId, sort_order: newSortOrder })
      .eq('id', id)

    if (err) {
      if (!silent) showError(`Failed to move "${moving?.name ?? id}": ${err.message}`)
      return false
    }

    if (moving) {
      moving.parent_id = newParentId
      moving.sort_order = newSortOrder
    }
    // Renumber siblings so sort_orders remain clean multiples of 1000 after the
    // fractional midpoint value introduced by getPendingSortOrder.
    renumberSiblings(newParentId)
    return true
  }

  /**
   * Reassigns sort_order as 1000, 2000, 3000… for all children of `parentId`.
   *
   * Necessary because `getPendingSortOrder` uses fractional midpoints for
   * drag-drop insertions. After enough insertions the values drift toward each
   * other; renumbering keeps them spread. Runs in the background — callers
   * don't need to await it.
   */
  async function renumberSiblings(parentId: string | null): Promise<void> {
    const siblings = entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

    const updates: PromiseLike<unknown>[] = []
    for (let i = 0; i < siblings.length; i++) {
      const clean = (i + 1) * 1000
      if (siblings[i]!.sort_order !== clean) {
        siblings[i]!.sort_order = clean
        updates.push(
          supabase.from('entries').update({ sort_order: clean }).eq('id', siblings[i]!.id).then(),
        )
      }
    }
    if (updates.length > 0) await Promise.all(updates)
  }

  // ---------------------------------------------------------------------------
  // Content access
  // ---------------------------------------------------------------------------

  /**
   * Returns the in-memory content for `entryId` synchronously.
   * Returns `undefined` on a cache miss (shouldn't happen for `.md` after
   * startup, but can happen for entries not yet synced).
   */
  function getCached(entryId: string): string | undefined {
    return contentMap.get(entryId)
  }

  /** Returns the full content map (used by the search store for snippet extraction). */
  function getContentMap(): Map<string, string> {
    return contentMap
  }

  /** Returns the live trigram index (used by the search store for candidate filtering). */
  function getTrigramIndex(): TrigramIndex {
    return trigramIndex
  }

  /**
   * Returns content for an entry, hitting the in-memory cache first.
   *
   * Cache hit path (normal): returns synchronously from `contentMap`.
   *
   * Cache miss paths:
   * - Binary files (PDF, image): downloaded from Supabase Storage.
   * - `.md` / `web` notes after a cache miss: re-fetched from the DB `content`
   *   column (shouldn't happen after startup, but guards against partial state).
   *
   * @returns The text content, or null if the entry doesn't exist or the
   *   download fails.
   */
  async function downloadContent(entryId: string): Promise<string | null> {
    const cached = contentMap.get(entryId)
    if (cached !== undefined) return cached

    const entry = entryById.value.get(entryId)
    if (!entry) return null

    if (entry.document_type !== 'md' && entry.document_type !== 'web') {
      // Binary file: fetch blob from Storage.
      if (!entry.storage_path) return null
      const { data, error: err } = await supabase.storage
        .from('user-files')
        .download(entry.storage_path)
      if (err) {
        showError('Failed to download file.')
        return null
      }
      return await data.text()
    }

    // .md / web: re-fetch from DB (should be a rare cold-start edge case).
    const { data, error: err } = await supabase
      .from('entries')
      .select('content')
      .eq('id', entryId)
      .single()

    if (err || data?.content == null) return null
    contentMap.set(entryId, data.content)
    return data.content
  }

  /**
   * Downloads the frozen snapshot HTML for a `web` document from Storage.
   * Distinct from `downloadContent`, which returns the user's notes column.
   *
   * @returns The HTML string, or null if the entry has no storage path or the
   *   download fails.
   */
  async function downloadSnapshot(entryId: string): Promise<string | null> {
    const entry = entryById.value.get(entryId)
    if (!entry?.storage_path) return null
    const { data, error: err } = await supabase.storage
      .from('user-files')
      .download(entry.storage_path)
    if (err) {
      showError('Failed to load captured page.')
      return null
    }
    return await data.text()
  }

  /**
   * Persists `content` for an entry, updating both the remote source of truth
   * and the in-memory cache and trigram index.
   *
   * For `.md` and `web` notes: writes to the DB `content` column.
   * For binary files: uploads to Supabase Storage (upsert).
   *
   * @returns true on success.
   */
  async function uploadContent(entryId: string, content: string): Promise<boolean> {
    const entry = entryById.value.get(entryId)
    if (!entry) return false

    if (entry.document_type === 'md' || entry.document_type === 'web') {
      const { error: err } = await supabase.from('entries').update({ content }).eq('id', entryId)

      if (err) return false

      // Keep in-memory state consistent with what was just saved.
      contentMap.set(entryId, content)
      updateTrigramsForFile(trigramIndex, entryId, content)
      return true
    }

    // Binary file: upsert into Storage.
    if (!entry.storage_path) return false
    const { error: err } = await supabase.storage
      .from('user-files')
      .update(entry.storage_path, new Blob([content], { type: 'text/plain' }), { upsert: true })

    return !err
  }

  // ---------------------------------------------------------------------------
  // Image support
  // ---------------------------------------------------------------------------

  // Public URLs are stable for the life of the session; no expiry needed.
  const imageUrlCache = new Map<string, string>()

  // Supabase Storage uses the MIME subtype as-is in paths, but some subtypes
  // don't make clean file extensions. Map the exceptions here.
  const MIME_EXT_MAP: Record<string, string> = {
    'svg+xml': 'svg',
    jpeg: 'jpg',
  }

  interface UploadedImage {
    entryId: string
    storagePath: string
    publicUrl: string
  }

  /**
   * Returns a name that doesn't already exist among siblings in `parentId`.
   * Appends ` (2)`, ` (3)`, … to the base name (before the extension) until
   * the name is unique.
   */
  function deduplicateName(name: string, parentId: string | null): string {
    const siblings = new Set(
      entries.value.filter((e) => e.parent_id === parentId).map((e) => e.name),
    )
    if (!siblings.has(name)) return name

    const dotIdx = name.lastIndexOf('.')
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name
    const ext = dotIdx > 0 ? name.slice(dotIdx) : ''
    let i = 2
    while (siblings.has(`${base} (${i})${ext}`)) i++
    return `${base} (${i})${ext}`
  }

  /**
   * Uploads an image file to Supabase Storage, creates a matching `image`
   * entry in the DB, and caches the public URL.
   *
   * Uses a random UUID as the storage filename (not the original filename) to
   * avoid collisions and ensure global uniqueness.
   *
   * @throws If the Storage upload or DB insert fails (caller should catch and
   *   show an error toast).
   */
  async function uploadImage(file: File, parentId: string | null): Promise<UploadedImage> {
    if (!auth.user) throw new Error('Not authenticated')

    const mimeSub = file.type.split('/')[1] ?? 'png'
    const ext = MIME_EXT_MAP[mimeSub] ?? mimeSub
    // Use a fresh UUID as the entry ID so we can pre-compute the storage path.
    const entryId = crypto.randomUUID()
    const filename = `${entryId}.${ext}`
    const storagePath = `${auth.user.id}/${filename}`

    const { error } = await supabase.storage
      .from('user-files')
      .upload(storagePath, file, { contentType: file.type })

    if (error) throw error

    const { data: urlData } = supabase.storage.from('user-files').getPublicUrl(storagePath)

    const baseName = file.name || `image.${ext}`
    const defaultName = deduplicateName(baseName, parentId)
    const { error: insertErr } = await supabase.from('entries').insert({
      id: entryId,
      user_id: auth.user.id,
      kind: 'document' as const,
      document_type: 'image' as const,
      name: defaultName,
      parent_id: parentId,
      storage_path: storagePath,
      sort_order: getNextSortOrder(parentId),
    })

    if (insertErr) throw insertErr

    // Mirror the insert in local state so the UI updates immediately.
    const newEntry: EntryRow = {
      id: entryId,
      user_id: auth.user.id,
      kind: 'document',
      document_type: 'image',
      name: defaultName,
      parent_id: parentId,
      storage_path: storagePath,
      content: null,
      metadata: null,
      sort_order: getNextSortOrder(parentId),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    entries.value.push(newEntry)

    imageUrlCache.set(entryId, urlData.publicUrl)

    return { entryId, storagePath, publicUrl: urlData.publicUrl }
  }

  /**
   * Returns the public CDN URL for an image entry.
   * Hits the in-memory cache; derives and caches the URL on a miss via the
   * Supabase Storage SDK (synchronous — no network request needed for public buckets).
   *
   * @returns null if the entry doesn't exist or has no storage path.
   */
  function getImageUrl(entryId: string): string | null {
    const cached = imageUrlCache.get(entryId)
    if (cached) return cached

    const entry = entryById.value.get(entryId)
    if (!entry?.storage_path) return null

    const { data } = supabase.storage.from('user-files').getPublicUrl(entry.storage_path)
    imageUrlCache.set(entryId, data.publicUrl)
    return data.publicUrl
  }

  /** Returns the raw EntryRow for an entry ID, or undefined if not found. */
  function getEntry(entryId: string): EntryRow | undefined {
    return entryById.value.get(entryId)
  }

  // ---------------------------------------------------------------------------
  // Web document support
  // ---------------------------------------------------------------------------

  /**
   * Derives a short human-readable display name from a URL.
   * Strips `www.` and omits the pathname when it's just `/`.
   * Falls back to the raw URL string on parse failure.
   */
  function nameFromUrl(url: string): string {
    try {
      const u = new URL(url)
      return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)
    } catch {
      return url
    }
  }

  /**
   * Captures a live URL into a frozen snapshot and persists it as a `web` entry.
   *
   * Storage layout:
   * - Snapshot HTML → Storage at `{userId}/{entryId}.html` (via `storage_path`)
   * - User notes → DB `content` column (initialized empty)
   * - `{ url, title, capturedAt }` → DB `metadata` column
   *
   * @throws If the Storage upload or DB insert fails. On insert failure, the
   *   already-uploaded snapshot blob is deleted to avoid orphaned Storage objects.
   *
   * @returns The created `EntryRow`, or null if not authenticated.
   */
  async function createWebDocument(url: string, parentId: string | null = null) {
    if (!auth.user) return null

    const capture = await captureWebPage(url)

    const entryId = crypto.randomUUID()
    const storagePath = `${auth.user.id}/${entryId}.html`

    const { error: uploadErr } = await supabase.storage
      .from('user-files')
      .upload(storagePath, new Blob([capture.html], { type: 'text/html' }), {
        contentType: 'text/html',
      })
    if (uploadErr) throw uploadErr

    const metadata = {
      url: capture.finalUrl,
      title: capture.title,
      capturedAt: new Date().toISOString(),
    }
    const name = deduplicateName(capture.title?.trim() || nameFromUrl(url), parentId)

    const { data, error: insertErr } = await supabase
      .from('entries')
      .insert({
        id: entryId,
        user_id: auth.user.id,
        kind: 'document' as const,
        document_type: 'web' as const,
        name,
        parent_id: parentId,
        storage_path: storagePath,
        content: '',
        metadata,
        sort_order: getNextSortOrder(parentId),
      })
      .select()
      .returns<EntryRow[]>()
      .single()

    if (insertErr || !data) {
      // Roll back the orphaned snapshot blob to keep Storage clean.
      await supabase.storage.from('user-files').remove([storagePath])
      console.error('createWebDocument insert failed:', insertErr)
      throw new Error(insertErr?.message ?? 'Failed to create web document.')
    }

    entries.value.push(data)
    // Seed contentMap with empty notes so the editor can open immediately.
    contentMap.set(data.id, '')
    return data
  }

  /**
   * Creates a "Welcome to Lilypad" markdown file for new users.
   * No-ops if the user already has entries (idempotent on repeated auth).
   */
  async function seedWelcomeFile() {
    if (!auth.user || entries.value.length > 0) return

    const welcomeContent = `# Welcome to Lilypad

Start taking notes by creating a new file using the **+** button in the sidebar.

## Features

- **Markdown editing** with live preview
- **Vim keybindings** for efficient editing
- **PDF annotations** (coming soon)
- **LaTeX math** support with KaTeX

Happy note-taking!
`

    const entry = await createDocument('Welcome.md', 'md')
    if (entry) {
      await uploadContent(entry.id, welcomeContent)
    }
  }

  /**
   * Resets all reactive state and clears all module-level caches.
   * Called on sign-out to prevent data leaking between user sessions.
   */
  function $reset() {
    entries.value = []
    loading.value = false
    indexReady.value = false
    selectedFolderId.value = null
    collapsedFolderIds.value = new Set()
    selectedIds.value = new Set()
    lastClickedId.value = null
    pendingCreate.value = null
    contentMap.clear()
    trigramIndex.clear()
    imageUrlCache.clear()
  }

  return {
    entries,
    tree,
    imageTree,
    loading,
    indexReady,
    selectedFolderId,
    collapsedFolderIds,
    selectedIds,
    lastClickedId,
    pendingCreate,
    fetchEntries,
    createDocument,
    createDirectory,
    renameEntry,
    deleteEntry,
    moveEntry,
    collectDescendantIds,
    selectFolder,
    isFolderCollapsed,
    expandFolder,
    collapseFolder,
    collapseAll,
    expandAll,
    toggleSelection,
    explodeAndToggle,
    setSelection,
    selectSingle,
    clearSelection,
    isSelected,
    rangeSelectTo,
    bulkDelete,
    bulkMove,
    getParentFolderId,
    beginCreate,
    triggerCreate,
    updatePendingPosition,
    getPendingSortOrder,
    clearPendingCreate,
    getAncestorPath,
    getFolderPath,
    getCached,
    getContentMap,
    getTrigramIndex,
    downloadContent,
    downloadSnapshot,
    uploadContent,
    uploadImage,
    getImageUrl,
    createWebDocument,
    getEntry,
    seedWelcomeFile,
    $reset,
  }
})
