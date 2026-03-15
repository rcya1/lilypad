import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import type { EntryRow } from '@/types/database'
import type { Entry, DocumentType } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'

// ---------------------------------------------------------------------------
// LRU content cache — keeps up to CACHE_MAX_BYTES of file content in memory.
// Map insertion order tracks recency: newest entries are at the end.
// ---------------------------------------------------------------------------
const CACHE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB
interface CacheEntry {
  content: string
  byteSize: number
}
const contentCache = new Map<string, CacheEntry>()
let cacheTotalBytes = 0

function cacheGet(entryId: string): string | undefined {
  const entry = contentCache.get(entryId)
  if (!entry) return undefined
  // Refresh recency: move to end of insertion-order
  contentCache.delete(entryId)
  contentCache.set(entryId, entry)
  return entry.content
}

function cacheSet(entryId: string, content: string) {
  const byteSize = new TextEncoder().encode(content).length
  if (contentCache.has(entryId)) {
    cacheTotalBytes -= contentCache.get(entryId)!.byteSize
    contentCache.delete(entryId)
  }
  // Evict oldest (LRU) entries until we're under the limit
  while (cacheTotalBytes + byteSize > CACHE_MAX_BYTES && contentCache.size > 0) {
    const oldestKey = contentCache.keys().next().value!
    cacheTotalBytes -= contentCache.get(oldestKey)!.byteSize
    contentCache.delete(oldestKey)
  }
  contentCache.set(entryId, { content, byteSize })
  cacheTotalBytes += byteSize
}

function cacheDelete(entryId: string) {
  if (contentCache.has(entryId)) {
    cacheTotalBytes -= contentCache.get(entryId)!.byteSize
    contentCache.delete(entryId)
  }
}

// Tracks in-flight prefetch requests so we don't duplicate work
const prefetching = new Set<string>()

export const useFilesStore = defineStore('files', () => {
  const auth = useAuthStore()
  const toast = useToastStore()
  const entries = ref<EntryRow[]>([])
  const loading = ref(false)
  const selectedFolderId = ref<string | null>(null)
  const collapsedFolderIds = ref(new Set<string>())
  const selectedIds = ref(new Set<string>())
  const lastClickedId = ref<string | null>(null)
  const pendingCreate = ref<{
    parentId: string | null
    type: 'file' | 'folder'
    insertBefore: string | null // null = append to end
  } | null>(null)

  const tree = computed<Entry[]>(() => buildTree(null))

  // Check if a name is already taken among siblings (excludeId = skip self when renaming)
  function isDuplicateName(name: string, parentId: string | null, excludeId?: string): boolean {
    return entries.value.some(
      (e) => e.parent_id === parentId && e.name === name && e.id !== excludeId,
    )
  }

  function showError(msg: string) {
    toast.addToast(msg, 'error')
  }

  function buildTree(parentId: string | null): Entry[] {
    const children = entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

    return children.map((row) => {
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

  function getNextSortOrder(parentId: string | null): number {
    const siblings = entries.value.filter((e) => e.parent_id === parentId)
    if (siblings.length === 0) return 1000
    return Math.max(...siblings.map((e) => e.sort_order)) + 1000
  }

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
    const prevOrder = idx > 0 ? siblings[idx - 1]!.sort_order : cur - 1000
    return (prevOrder + cur) / 2
  }

  function selectFolder(id: string | null) {
    selectedFolderId.value = id
  }

  function isFolderCollapsed(id: string): boolean {
    return collapsedFolderIds.value.has(id)
  }

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

  function toggleSelection(id: string) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    lastClickedId.value = id
  }

  function setSelection(ids: string[]) {
    selectedIds.value = new Set(ids)
  }

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

  /** Flat ordered list of all visible entry IDs (folders + documents, respects collapse). */
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

  /** Walk up the tree to find the closest ancestor whose ID is in selectedIds. */
  function findSelectedAncestor(id: string): string | null {
    let parentId = entries.value.find((e) => e.id === id)?.parent_id ?? null
    while (parentId) {
      if (selectedIds.value.has(parentId)) return parentId
      parentId = entries.value.find((e) => e.id === parentId)?.parent_id ?? null
    }
    return null
  }

  /**
   * If a selected ancestor exists: "explode" it by replacing it with all its
   * direct children, then toggle the clicked item. Otherwise, plain toggle.
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

  async function bulkDelete(ids: string[]): Promise<boolean> {
    // Only delete top-level entries (skip if an ancestor is also in the set)
    const idSet = new Set(ids)
    const topLevel = ids.filter((id) => {
      let parentId = entries.value.find((e) => e.id === id)?.parent_id ?? null
      while (parentId) {
        if (idSet.has(parentId)) return false
        parentId = entries.value.find((e) => e.id === parentId)?.parent_id ?? null
      }
      return true
    })
    const results = await Promise.all(topLevel.map((id) => deleteEntry(id)))
    clearSelection()
    return results.every(Boolean)
  }

  async function bulkMove(ids: string[], targetFolderId: string | null): Promise<boolean> {
    const base = getNextSortOrder(targetFolderId)
    const results = await Promise.all(
      ids.map((id, i) => moveEntry(id, targetFolderId, base + i * 1000)),
    )
    clearSelection()
    return results.every(Boolean)
  }

  /**
   * Given a file/document id, returns the id of its parent folder, or null if
   * the entry lives at the root (or is not found).
   */
  function getParentFolderId(fileId: string): string | null {
    const entry = entries.value.find((e) => e.id === fileId)
    return entry?.parent_id ?? null
  }

  /**
   * Returns the ordered list of ancestor directories from root to immediate
   * parent for the given file id.
   */
  function getAncestorPath(fileId: string): { id: string; name: string }[] {
    const entry = entries.value.find((e) => e.id === fileId)
    if (!entry?.parent_id) return []
    const segments: { id: string; name: string }[] = []
    let currentId: string | null = entry.parent_id
    while (currentId) {
      const parent = entries.value.find((e) => e.id === currentId)
      if (!parent) break
      segments.unshift({ id: parent.id, name: parent.name })
      currentId = parent.parent_id
    }
    return segments
  }

  /**
   * Programmatic entry point for starting an inline file creation. Used by the
   * global Ctrl+N shortcut. Mirrors the priority logic in FileExplorer's
   * startNewFile: selectedFolderId → parent of active tab → root.
   */
  function beginCreate(
    kind: 'document' | 'folder',
    parentId: string | null,
  ) {
    triggerCreate(parentId, kind === 'document' ? 'file' : 'folder')
  }

  function triggerCreate(
    parentId: string | null,
    type: 'file' | 'folder',
    insertBefore: string | null = null,
  ) {
    pendingCreate.value = { parentId, type, insertBefore }
  }

  function updatePendingPosition(parentId: string | null, insertBefore: string | null) {
    if (!pendingCreate.value) return
    pendingCreate.value = { ...pendingCreate.value, parentId, insertBefore }
  }

  function clearPendingCreate() {
    pendingCreate.value = null
  }

  async function fetchEntries() {
    if (!auth.user) return
    loading.value = true

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
    }
    loading.value = false
  }

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

    const { data, error: err } = await supabase
      .from('entries')
      .insert({
        user_id: auth.user.id,
        kind: 'document' as const,
        name,
        document_type: type,
        parent_id: parentId,
        sort_order: sortOrder ?? getNextSortOrder(parentId),
      })
      .select()
      .returns<EntryRow[]>()
      .single()

    if (err || !data) {
      showError('Failed to create file.')
      return null
    }

    const ext = type === 'pdf' ? 'pdf' : 'md'
    const storagePath = `${auth.user.id}/${data.id}.${ext}`

    await supabase.storage
      .from('user-files')
      .upload(storagePath, new Blob([''], { type: 'text/plain' }))

    await supabase.from('entries').update({ storage_path: storagePath }).eq('id', data.id)

    data.storage_path = storagePath
    entries.value.push(data)
    return data
  }

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
    return data
  }

  async function renameEntry(id: string, newName: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry && isDuplicateName(newName, entry.parent_id, id)) {
      showError('A file or folder with that name already exists in this location.')
      return false
    }

    const { error: err } = await supabase.from('entries').update({ name: newName }).eq('id', id)

    if (err) {
      showError('Failed to rename entry.')
      return false
    }

    if (entry) entry.name = newName
    return true
  }

  async function deleteEntry(id: string) {
    const idsToDelete = collectDescendantIds(id)

    const storagePaths = idsToDelete
      .map((did) => entries.value.find((e) => e.id === did))
      .filter((e) => e?.storage_path)
      .map((e) => e!.storage_path!)

    if (storagePaths.length > 0) {
      await supabase.storage.from('user-files').remove(storagePaths)
    }

    const { error: err } = await supabase.from('entries').delete().eq('id', id)

    if (err) {
      showError('Failed to delete entry.')
      return false
    }

    entries.value = entries.value.filter((e) => !idsToDelete.includes(e.id))
    idsToDelete.forEach(cacheDelete)

    if (selectedFolderId.value && idsToDelete.includes(selectedFolderId.value)) {
      selectedFolderId.value = null
    }

    return true
  }

  function collectDescendantIds(id: string): string[] {
    const result = [id]
    const children = entries.value.filter((e) => e.parent_id === id)
    for (const child of children) {
      result.push(...collectDescendantIds(child.id))
    }
    return result
  }

  async function moveEntry(
    id: string,
    newParentId: string | null,
    newSortOrder: number,
    silent = false,
  ): Promise<boolean> {
    const descendants = collectDescendantIds(id)
    if (newParentId !== null && descendants.includes(newParentId)) return false

    const moving = entries.value.find((e) => e.id === id)
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
    return true
  }

  /** Returns cached content synchronously, or undefined on a cache miss. */
  function getCached(entryId: string): string | undefined {
    return cacheGet(entryId)
  }

  /** Returns all currently cached entry IDs and their content. Used by the search store. */
  function getCachedEntries(): Map<string, string> {
    const result = new Map<string, string>()
    for (const [id, entry] of contentCache) {
      result.set(id, entry.content)
    }
    return result
  }

  async function downloadContent(entryId: string): Promise<string | null> {
    const cached = cacheGet(entryId)
    if (cached !== undefined) return cached

    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry?.storage_path) return null

    const { data, error: err } = await supabase.storage
      .from('user-files')
      .download(entry.storage_path)

    if (err) {
      showError('Failed to download file.')
      return null
    }

    const content = await data.text()
    cacheSet(entryId, content)
    return content
  }

  /** Silently pre-warms the cache for a file without opening it. */
  async function prefetchContent(entryId: string): Promise<void> {
    if (contentCache.has(entryId) || prefetching.has(entryId)) return
    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry?.storage_path) return
    prefetching.add(entryId)
    try {
      const { data, error: err } = await supabase.storage
        .from('user-files')
        .download(entry.storage_path)
      if (!err) cacheSet(entryId, await data.text())
    } finally {
      prefetching.delete(entryId)
    }
  }

  async function uploadContent(entryId: string, content: string): Promise<boolean> {
    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry?.storage_path) return false

    const { error: err } = await supabase.storage
      .from('user-files')
      .update(entry.storage_path, new Blob([content], { type: 'text/plain' }), { upsert: true })

    if (err) {
      return false
    }

    // Keep cache in sync with the saved version
    cacheSet(entryId, content)
    return true
  }

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
    if (entry?.storage_path) {
      await supabase.storage
        .from('user-files')
        .update(entry.storage_path, new Blob([welcomeContent], { type: 'text/plain' }), {
          upsert: true,
        })
    }
  }

  function $reset() {
    entries.value = []
    loading.value = false
    selectedFolderId.value = null
    collapsedFolderIds.value = new Set()
    selectedIds.value = new Set()
    lastClickedId.value = null
    pendingCreate.value = null
  }

  return {
    entries,
    tree,
    loading,
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
    getCached,
    getCachedEntries,
    downloadContent,
    prefetchContent,
    uploadContent,
    seedWelcomeFile,
    $reset,
  }
})
