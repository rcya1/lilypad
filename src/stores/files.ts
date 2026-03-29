import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
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
// In-memory content store — all .md content loaded on startup.
// No eviction, no size tracking. Typical usage: 200 files × 5KB = 1MB.
// ---------------------------------------------------------------------------
const contentMap = new Map<string, string>()
const trigramIndex: TrigramIndex = new Map()

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
  /** True while the trigram index is being built (blocks search). */
  const indexReady = ref(false)

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
  function beginCreate(kind: 'document' | 'folder', parentId: string | null) {
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

  // ---------------------------------------------------------------------------
  // Content map & trigram index helpers
  // ---------------------------------------------------------------------------

  function populateContentMap(): void {
    contentMap.clear()
    for (const entry of entries.value) {
      if (entry.document_type === 'md' && entry.content != null) {
        contentMap.set(entry.id, entry.content)
      }
    }
  }

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

  async function fetchEntries() {
    if (!auth.user) return
    loading.value = true
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
        // For .md files, content lives in the DB — start empty
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
      // Binary files (PDF, images) still use Storage
      const ext = type === 'pdf' ? 'pdf' : type
      const storagePath = `${auth.user.id}/${data.id}.${ext}`

      await supabase.storage
        .from('user-files')
        .upload(storagePath, new Blob([''], { type: 'text/plain' }))

      await supabase.from('entries').update({ storage_path: storagePath }).eq('id', data.id)

      data.storage_path = storagePath
    } else {
      // .md: content is in the DB, update in-memory state
      contentMap.set(data.id, '')
      // Empty string has no trigrams, nothing to index
    }

    entries.value.push(data)
    if (sortOrder != null) renumberSiblings(parentId)
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
    if (sortOrder != null) renumberSiblings(parentId)
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

    // Only clean up Storage for entries that have a storage_path (binary files)
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

    // Clean up contentMap and trigram index
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
    // Renumber siblings so sort_orders stay clean integers
    renumberSiblings(newParentId)
    return true
  }

  /**
   * Reassign sort_order as 1000, 2000, 3000… for all children of a parent.
   * Keeps values clean after repeated midpoint insertions. Runs in the
   * background — callers don't need to await it.
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

  /** Returns in-memory content synchronously, or undefined on miss. */
  function getCached(entryId: string): string | undefined {
    return contentMap.get(entryId)
  }

  /** Returns the full content map (for search). */
  function getContentMap(): Map<string, string> {
    return contentMap
  }

  /** Returns the trigram index (for search). */
  function getTrigramIndex(): TrigramIndex {
    return trigramIndex
  }

  async function downloadContent(entryId: string): Promise<string | null> {
    // In-memory hit (normal path — startup loaded everything for .md)
    const cached = contentMap.get(entryId)
    if (cached !== undefined) return cached

    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry) return null

    // For binary files (PDF, image), fall back to Storage download
    if (entry.document_type !== 'md') {
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

    // For .md files, fetch content from DB (shouldn't happen after startup)
    const { data, error: err } = await supabase
      .from('entries')
      .select('content')
      .eq('id', entryId)
      .single()

    if (err || !data?.content) return null
    contentMap.set(entryId, data.content)
    return data.content
  }

  async function uploadContent(entryId: string, content: string): Promise<boolean> {
    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry) return false

    if (entry.document_type === 'md') {
      // .md files: content lives in the DB
      const { error: err } = await supabase.from('entries').update({ content }).eq('id', entryId)

      if (err) return false

      // Update in-memory state
      contentMap.set(entryId, content)
      updateTrigramsForFile(trigramIndex, entryId, content)
      return true
    }

    // Binary files: Storage upload (unchanged)
    if (!entry.storage_path) return false
    const { error: err } = await supabase.storage
      .from('user-files')
      .update(entry.storage_path, new Blob([content], { type: 'text/plain' }), { upsert: true })

    return !err
  }

  // ---------------------------------------------------------------------------
  // Image support
  // ---------------------------------------------------------------------------

  const imageUrlCache = new Map<string, string>()

  const MIME_EXT_MAP: Record<string, string> = {
    'svg+xml': 'svg',
    jpeg: 'jpg',
  }

  interface UploadedImage {
    entryId: string
    storagePath: string
    publicUrl: string
  }

  /** Return a name unique among siblings in the given parent folder. */
  function deduplicateName(name: string, parentId: string | null): string {
    const siblings = new Set(
      entries.value
        .filter((e) => e.parent_id === parentId)
        .map((e) => e.name),
    )
    if (!siblings.has(name)) return name

    const dotIdx = name.lastIndexOf('.')
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name
    const ext = dotIdx > 0 ? name.slice(dotIdx) : ''
    let i = 2
    while (siblings.has(`${base} (${i})${ext}`)) i++
    return `${base} (${i})${ext}`
  }

  async function uploadImage(file: File, parentId: string | null): Promise<UploadedImage> {
    if (!auth.user) throw new Error('Not authenticated')

    const mimeSub = file.type.split('/')[1] ?? 'png'
    const ext = MIME_EXT_MAP[mimeSub] ?? mimeSub
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

    // Add to local state
    const newEntry: EntryRow = {
      id: entryId,
      user_id: auth.user.id,
      kind: 'document',
      document_type: 'image',
      name: defaultName,
      parent_id: parentId,
      storage_path: storagePath,
      content: null,
      sort_order: getNextSortOrder(parentId),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    entries.value.push(newEntry)

    // Cache the URL
    imageUrlCache.set(entryId, urlData.publicUrl)

    return { entryId, storagePath, publicUrl: urlData.publicUrl }
  }

  function getImageUrl(entryId: string): string | null {
    const cached = imageUrlCache.get(entryId)
    if (cached) return cached

    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry?.storage_path) return null

    const { data } = supabase.storage.from('user-files').getPublicUrl(entry.storage_path)
    imageUrlCache.set(entryId, data.publicUrl)
    return data.publicUrl
  }

  function getEntry(entryId: string): EntryRow | undefined {
    return entries.value.find((e) => e.id === entryId)
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
    if (entry) {
      await uploadContent(entry.id, welcomeContent)
    }
  }

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
    getCached,
    getContentMap,
    getTrigramIndex,
    downloadContent,
    uploadContent,
    uploadImage,
    getImageUrl,
    getEntry,
    seedWelcomeFile,
    $reset,
  }
})
