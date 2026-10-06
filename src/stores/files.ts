// Pinia store for the file tree, note text, search index, image uploads, web captures and PDFs.
// Offline-first: changes apply locally, are saved on the device, and are pushed by the sync store.
// Image uploads, web captures and PDF imports still need a connection.
import { defineStore } from 'pinia'
import { ref, computed, watch, toRaw } from 'vue'
import { supabase } from '@/lib/supabase'
import { captureWebPage } from '@/lib/webCapture'
import { fetchPdfIntoStorage, pdfFileName, MAX_PDF_BYTES } from '@/lib/pdfFetch'
import { hasPdfHeader, readPdfInfo } from '@/lib/pdfjs'
import { loadSnapshot, saveSnapshot, type OfflineSnapshot } from '@/lib/offline'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import { useSyncStore } from './sync'
import { useEditorStore } from './editor'
import type { EntryRow, PdfDocMeta } from '@/types/database'
import type { Entry, DocumentType } from '@/types/file-explorer'
import { isDirectory, hasNoteContent } from '@/types/file-explorer'
import {
  buildTrigramIndex as buildIndex,
  updateTrigramsForFile,
  removeFileFromIndex,
  type TrigramIndex,
} from '@/lib/trigram'
import {
  getNextSortOrder as entryTreeGetNextSortOrder,
  collectDescendantIds as entryTreeCollectDescendantIds,
  filterTopLevelIds as entryTreeFilterTopLevelIds,
  isDuplicateName as entryTreeIsDuplicateName,
  deduplicateName as entryTreeDeduplicateName,
} from '@/lib/entry-tree'

// Outside the store so they survive hot reloads, and so search can read them without reactivity
// (too large to make reactive). contentMap holds the text of every md/web/pdf note.
const contentMap = new Map<string, string>()
const trigramIndex: TrigramIndex = new Map()

export const useFilesStore = defineStore('files', () => {
  const auth = useAuthStore()
  const toast = useToastStore()
  const sync = useSyncStore()

  // Server rows plus local changes not yet synced.
  const entries = ref<EntryRow[]>([])
  const loading = ref(false)
  // Set by the first server load; gates first-run seeding so an offline start can't duplicate it.
  let serverLoaded = false

  // Default parent for new files.
  const selectedFolderId = ref<string | null>(null)
  const collapsedFolderIds = ref(new Set<string>())
  const selectedIds = ref(new Set<string>())
  // Anchor for Shift+click range selection.
  const lastClickedId = ref<string | null>(null)

  /** When set, the explorer shows an inline name input here. `insertBefore: null` appends. */
  const pendingCreate = ref<{
    parentId: string | null
    type: 'file' | 'folder'
    insertBefore: string | null
  } | null>(null)
  const indexReady = ref(false)

  const entryById = computed(() => {
    const map = new Map<string, EntryRow>()
    for (const e of entries.value) map.set(e.id, e)
    return map
  })

  const tree = computed<Entry[]>(() => buildTree(null))
  const imageTree = computed<Entry[]>(() => buildImageTree(null))

  /** Pass `excludeId` when renaming so the entry doesn't collide with itself. */
  function isDuplicateName(name: string, parentId: string | null, excludeId?: string): boolean {
    return entryTreeIsDuplicateName(entries.value, name, parentId, excludeId)
  }

  function showError(msg: string) {
    toast.addToast(msg, 'error')
  }

  /** `include` filters rows; directories are always recursed into. */
  function buildTreeWith(parentId: string | null, include: (row: EntryRow) => boolean): Entry[] {
    return entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .filter(include)
      .map((row) =>
        row.kind === 'directory'
          ? {
              kind: 'directory' as const,
              id: row.id,
              name: row.name,
              parentId: row.parent_id,
              children: buildTreeWith(row.id, include),
            }
          : {
              kind: 'document' as const,
              id: row.id,
              name: row.name,
              parentId: row.parent_id,
              type: row.document_type as DocumentType,
            },
      )
  }

  function buildTree(parentId: string | null): Entry[] {
    return buildTreeWith(parentId, (row) => row.document_type !== 'image')
  }

  // Folders always show, so images keep their structure.
  function buildImageTree(parentId: string | null): Entry[] {
    return buildTreeWith(
      parentId,
      (row) => row.document_type === 'image' || row.kind === 'directory',
    )
  }

  /** 1000-step gaps leave room for midpoint inserts before renumbering. */
  function getNextSortOrder(parentId: string | null): number {
    return entryTreeGetNextSortOrder(entries.value, parentId)
  }

  /** Midpoint between `insertBefore` and its previous sibling (fractional), else append. */
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

  // Replace the Set rather than mutate it so watchers fire reliably.
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

  /** Also moves the Shift+click anchor here. */
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

  /** Visible entries in display order (skipping collapsed folders), for range selection. */
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

  /** Selects the visible range from the anchor to `id`; plain toggle if either isn't visible. */
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

  function findSelectedAncestor(id: string): string | null {
    let parentId = entryById.value.get(id)?.parent_id ?? null
    while (parentId) {
      if (selectedIds.value.has(parentId)) return parentId
      parentId = entryById.value.get(parentId)?.parent_id ?? null
    }
    return null
  }

  /**
   * Clicking a child of a selected folder "explodes" the folder: its selection is replaced by its
   * other children, then the clicked child toggles as usual.
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
    // Descendants go with their folder.
    const topLevel = filterTopLevelIds(ids)
    const results = await Promise.all(topLevel.map((id) => deleteEntry(id)))
    clearSelection()
    return results.every(Boolean)
  }

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

  function getParentFolderId(fileId: string): string | null {
    const entry = entryById.value.get(fileId)
    return entry?.parent_id ?? null
  }

  /** Ancestor folders, root first. */
  function getAncestorPath(fileId: string): { id: string; name: string }[] {
    const entry = entryById.value.get(fileId)
    if (!entry?.parent_id) return []
    const segments: { id: string; name: string }[] = []
    let currentId: string | null = entry.parent_id
    while (currentId) {
      const parent = entryById.value.get(currentId)
      if (!parent) break
      segments.unshift({ id: parent.id, name: parent.name })
      currentId = parent.parent_id
    }
    return segments
  }

  /** e.g. "Notes / Math"; empty at the top level. */
  function getFolderPath(fileId: string): string {
    return getAncestorPath(fileId)
      .map((segment) => segment.name)
      .join(' / ')
  }

  /** For the Ctrl+N shortcut. */
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

  /** Only notes keep their text in the DB; binary files live in Storage. */
  function populateContentMap(): void {
    contentMap.clear()
    for (const entry of entries.value) {
      if (hasNoteContent(entry.document_type) && entry.content != null) {
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

  /**
   * Shows the on-device copy first (instant, and all there is offline), then pushes offline
   * changes and pulls the server's state over it.
   */
  async function fetchEntries() {
    if (!auth.user) return
    const uid = auth.user.id
    loading.value = true
    indexReady.value = false
    await sync.init(uid)

    if (entries.value.length === 0) {
      const snapshot = await loadSnapshot(uid)
      if (snapshot) {
        applySnapshot(snapshot)
        loading.value = false
      }
    }

    await sync.flush()
    const ok = await refreshFromServer()
    if (!ok && entries.value.length === 0 && sync.online) showError('Failed to load files.')
    if (!indexReady.value) rebuildTrigramIndex()
    loading.value = false
  }

  /**
   * Makes the server's rows the local state, except for changes it hasn't seen yet: queued
   * creates/renames/moves/deletes stay on top, and a note keeps its local text while it has
   * unsynced edits, a conflict or unsaved typing. Open editors pick up newer server text. Returns
   * false if the server couldn't be reached.
   */
  async function refreshFromServer(): Promise<boolean> {
    if (!auth.user) return false
    const { data, error: err } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('sort_order')
      .returns<EntryRow[]>()
    if (err || !data) return false

    const editor = useEditorStore()
    const serverIds = new Set(data.map((row) => row.id))
    const next: EntryRow[] = []

    for (const row of data) {
      if (sync.hasPending(row.id, 'delete')) continue
      const local = entryById.value.get(row.id)
      next.push(
        local && sync.hasPending(row.id, 'update')
          ? { ...row, name: local.name, parent_id: local.parent_id, sort_order: local.sort_order }
          : row,
      )

      if (!hasNoteContent(row.document_type)) continue
      const hasLocalEdits =
        sync.hasPending(row.id, 'content') ||
        sync.conflictIds.has(row.id) ||
        editor.dirtyIds.has(row.id)
      if (hasLocalEdits && contentMap.has(row.id)) continue
      const text = row.content ?? ''
      sync.setBase(row.id, { version: row.version ?? null, content: text })
      if (contentMap.get(row.id) !== text) {
        contentMap.set(row.id, text)
        editor.applyExternalContent(row.id, text)
      }
    }
    // Created on this device and not on the server yet.
    for (const local of entries.value) {
      if (!serverIds.has(local.id) && sync.hasPending(local.id, 'create')) next.push(local)
    }

    const kept = new Set(next.map((row) => row.id))
    for (const id of contentMap.keys()) {
      if (!kept.has(id)) {
        contentMap.delete(id)
        sync.deleteBase(id)
      }
    }
    entries.value = next
    rebuildTrigramIndex()
    serverLoaded = true
    persistSnapshot()
    return true
  }

  function applySnapshot(snapshot: OfflineSnapshot) {
    entries.value = snapshot.entries
    sync.importBases(snapshot.bases)
    populateContentMap()
    rebuildTrigramIndex()
  }

  let snapshotTimer = 0

  /** Debounced. */
  function persistSnapshot() {
    if (!auth.user) return
    const uid = auth.user.id
    clearTimeout(snapshotTimer)
    snapshotTimer = window.setTimeout(() => {
      const rows = entries.value.map((row) => ({
        ...toRaw(row),
        content: contentMap.get(row.id) ?? row.content,
      }))
      // JSON round-trip: plain data only (IndexedDB can't clone Vue proxies).
      const snapshot: OfflineSnapshot = JSON.parse(
        JSON.stringify({ entries: rows, bases: sync.exportBases() }),
      )
      void saveSnapshot(uid, snapshot)
    }, 400)
  }

  watch(entries, persistSnapshot, { deep: true })

  function patchEntry(id: string, fields: Partial<EntryRow>) {
    const entry = entryById.value.get(id)
    if (entry) Object.assign(entry, fields)
  }

  /** The editor's buffer if it's open (may be newer than the last save), else the saved text. */
  function getLatestText(id: string): string | undefined {
    return useEditorStore().openDocuments.get(id)?.content ?? contentMap.get(id)
  }

  function applyMergedContent(id: string, text: string) {
    contentMap.set(id, text)
    updateTrigramsForFile(trigramIndex, id, text)
    useEditorStore().applyExternalContent(id, text)
    persistSnapshot()
  }

  function requireOnline(action: string) {
    if (!sync.online) throw new Error(`${action} needs a connection.`)
  }

  /** Fills in what the database would otherwise default. */
  function newRow(
    fields: Omit<
      EntryRow,
      | 'id'
      | 'user_id'
      | 'created_at'
      | 'updated_at'
      | 'storage_path'
      | 'content'
      | 'metadata'
      | 'document_type'
    > &
      Partial<EntryRow>,
  ): EntryRow {
    const now = new Date().toISOString()
    return {
      id: crypto.randomUUID(),
      user_id: auth.user!.id,
      document_type: null,
      storage_path: null,
      content: null,
      metadata: null,
      created_at: now,
      updated_at: now,
      ...fields,
    }
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

    // Markdown notes are created locally and synced (works offline).
    if (type === 'md') {
      const row = newRow({
        kind: 'document',
        name,
        document_type: 'md',
        parent_id: parentId,
        sort_order: sortOrder ?? getNextSortOrder(parentId),
        content: '',
      })
      entries.value.push(row)
      contentMap.set(row.id, '')
      sync.enqueue({ kind: 'create', row: { ...row } })
      if (sortOrder != null) renumberSiblings(parentId)
      return entries.value[entries.value.length - 1]!
    }

    // Other types need a Storage placeholder, so they need a connection.
    if (!sync.online) {
      showError('Creating this kind of file needs a connection.')
      return null
    }
    const id = crypto.randomUUID()
    const ext = type === 'pdf' ? 'pdf' : type
    const storagePath = `${auth.user.id}/${id}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('user-files')
      .upload(storagePath, new Blob([''], { type: 'text/plain' }))
    if (uploadErr) {
      showError('Failed to create file.')
      return null
    }

    const { data, error: err } = await supabase
      .from('entries')
      .insert({
        id,
        user_id: auth.user.id,
        kind: 'document' as const,
        name,
        document_type: type,
        parent_id: parentId,
        storage_path: storagePath,
        sort_order: sortOrder ?? getNextSortOrder(parentId),
      })
      .select()
      .returns<EntryRow[]>()
      .single()

    if (err || !data) {
      // Remove the placeholder so no blob exists without an entry.
      await supabase.storage.from('user-files').remove([storagePath])
      showError('Failed to create file.')
      return null
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

    const row = newRow({
      kind: 'directory',
      name,
      parent_id: parentId,
      sort_order: sortOrder ?? getNextSortOrder(parentId),
    })
    entries.value.push(row)
    sync.enqueue({ kind: 'create', row: { ...row } })
    if (sortOrder != null) renumberSiblings(parentId)
    return entries.value[entries.value.length - 1]!
  }

  async function renameEntry(id: string, newName: string) {
    const entry = entryById.value.get(id)
    if (entry && isDuplicateName(newName, entry.parent_id, id)) {
      showError('A file or folder with that name already exists in this location.')
      return false
    }

    if (entry) entry.name = newName
    sync.enqueue({ kind: 'update', id, fields: { name: newName } })
    return true
  }

  /** Deletes the entry and everything under it. */
  async function deleteEntry(id: string) {
    const idsToDelete = collectDescendantIds(id)

    // Collected before the rows are removed.
    const storagePaths = idsToDelete
      .map((did) => entryById.value.get(did))
      .filter((e) => e?.storage_path)
      .map((e) => e!.storage_path!)

    // Queued changes inside are moot; the server cascades the delete to descendants.
    sync.dropOpsFor(idsToDelete.filter((did) => did !== id))
    sync.enqueue({ kind: 'delete', id, storagePaths })
    for (const did of idsToDelete) {
      sync.deleteBase(did)
      if (sync.conflictIds.has(did)) sync.setConflict(did, false)
    }

    entries.value = entries.value.filter((e) => !idsToDelete.includes(e.id))

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
    return entryTreeCollectDescendantIds(entries.value, id)
  }

  /** Drops ids whose ancestor is also in `ids` (the folder already covers them). */
  function filterTopLevelIds(ids: Iterable<string>): string[] {
    return entryTreeFilterTopLevelIds(entryById.value, ids)
  }

  /** `silent` suppresses toasts (bulk moves report errors themselves). */
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

    if (moving) {
      moving.parent_id = newParentId
      moving.sort_order = newSortOrder
    }
    sync.enqueue({
      kind: 'update',
      id,
      fields: { parent_id: newParentId, sort_order: newSortOrder },
    })
    // Clean up the fractional midpoint from getPendingSortOrder.
    renumberSiblings(newParentId)
    return true
  }

  /** Respaces sort_orders to 1000, 2000, … once midpoint inserts have squeezed them together. */
  async function renumberSiblings(parentId: string | null): Promise<void> {
    const siblings = entries.value
      .filter((e) => e.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

    for (let i = 0; i < siblings.length; i++) {
      const clean = (i + 1) * 1000
      if (siblings[i]!.sort_order !== clean) {
        siblings[i]!.sort_order = clean
        sync.enqueue({ kind: 'update', id: siblings[i]!.id, fields: { sort_order: clean } })
      }
    }
  }

  function getCached(entryId: string): string | undefined {
    return contentMap.get(entryId)
  }

  function getContentMap(): Map<string, string> {
    return contentMap
  }

  function getTrigramIndex(): TrigramIndex {
    return trigramIndex
  }

  /** Cache first. Binary files come from Storage; a missing note is re-fetched from the DB. */
  async function downloadContent(entryId: string): Promise<string | null> {
    const cached = contentMap.get(entryId)
    if (cached !== undefined) return cached

    const entry = entryById.value.get(entryId)
    if (!entry) return null

    if (!hasNoteContent(entry.document_type)) {
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

    const { data, error: err } = await supabase
      .from('entries')
      .select('content')
      .eq('id', entryId)
      .single()

    if (err || data?.content == null) return null
    contentMap.set(entryId, data.content)
    return data.content
  }

  /** The captured page's HTML (the notes are `content`). */
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
    // Fixes for pages captured before tools/capture.mjs did these itself: `font-display: optional`
    // gives up on late-loading web fonts, and a stylesheet's BOM glued mid-<style> invalidates the
    // rule after it (often the site's main @font-face).
    return (await data.text())
      .replace(/font-display\s*:\s*(?:optional|fallback)/gi, 'font-display: swap')
      .replace(/﻿(?=@)/g, '')
  }

  /** The PDF's bytes (the notes are `content`). */
  async function downloadPdf(entryId: string): Promise<ArrayBuffer | null> {
    const entry = entryById.value.get(entryId)
    if (!entry?.storage_path) return null
    const { data, error: err } = await supabase.storage
      .from('user-files')
      .download(entry.storage_path)
    if (err) {
      showError('Failed to load the PDF.')
      return null
    }
    return await data.arrayBuffer()
  }

  /** Notes save locally and go to sync (works offline); binary files upload to Storage. */
  async function uploadContent(entryId: string, content: string): Promise<boolean> {
    const entry = entryById.value.get(entryId)
    if (!entry) return false

    if (hasNoteContent(entry.document_type)) {
      contentMap.set(entryId, content)
      updateTrigramsForFile(trigramIndex, entryId, content)
      persistSnapshot()
      sync.noteChanged(entryId, content)
      return true
    }

    if (!entry.storage_path) return false
    const { error: err } = await supabase.storage
      .from('user-files')
      .update(entry.storage_path, new Blob([content], { type: 'text/plain' }), { upsert: true })

    return !err
  }

  // Public URLs never expire.
  const imageUrlCache = new Map<string, string>()

  // MIME subtypes that don't make sensible file extensions.
  const MIME_EXT_MAP: Record<string, string> = {
    'svg+xml': 'svg',
    jpeg: 'jpg',
  }

  interface UploadedImage {
    entryId: string
    storagePath: string
    publicUrl: string
  }

  function deduplicateName(name: string, parentId: string | null): string {
    return entryTreeDeduplicateName(entries.value, name, parentId)
  }

  /** Throws on failure; the caller shows the error. */
  async function uploadImage(file: File, parentId: string | null): Promise<UploadedImage> {
    if (!auth.user) throw new Error('Not authenticated')
    requireOnline('Uploading images')

    const mimeSub = file.type.split('/')[1] ?? 'png'
    const ext = MIME_EXT_MAP[mimeSub] ?? mimeSub
    // The entry id doubles as the file name, so the storage path is known up front.
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

  /** Derived locally (public bucket, no request) and cached. */
  function getImageUrl(entryId: string): string | null {
    const cached = imageUrlCache.get(entryId)
    if (cached) return cached

    const entry = entryById.value.get(entryId)
    if (!entry?.storage_path) return null

    const { data } = supabase.storage.from('user-files').getPublicUrl(entry.storage_path)
    imageUrlCache.set(entryId, data.publicUrl)
    return data.publicUrl
  }

  function getEntry(entryId: string): EntryRow | undefined {
    return entryById.value.get(entryId)
  }

  /** Hostname without `www.`, plus the path unless it's `/`. */
  function nameFromUrl(url: string): string {
    try {
      const u = new URL(url)
      return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)
    } catch {
      return url
    }
  }

  /**
   * Captures `url` as a `web` entry: snapshot HTML in Storage (`{userId}/{entryId}.html`), notes in
   * `content`, `{ url, title, capturedAt }` in `metadata`. Throws on failure.
   */
  async function createWebDocument(url: string, parentId: string | null = null) {
    if (!auth.user) return null
    requireOnline('Capturing a web page')

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
      // Don't leave an orphaned snapshot.
      await supabase.storage.from('user-files').remove([storagePath])
      console.error('createWebDocument insert failed:', insertErr)
      throw new Error(insertErr?.message ?? 'Failed to create web document.')
    }

    entries.value.push(data)
    contentMap.set(data.id, '')
    sync.setBase(data.id, { version: data.version ?? null, content: '' })
    return data
  }

  /** Inserts a `pdf` row for a blob already in Storage; removes the blob if the insert fails. */
  async function insertPdfEntry(
    entryId: string,
    storagePath: string,
    name: string,
    parentId: string | null,
    metadata: PdfDocMeta,
  ): Promise<EntryRow> {
    const { data, error: insertErr } = await supabase
      .from('entries')
      .insert({
        id: entryId,
        user_id: auth.user!.id,
        kind: 'document' as const,
        document_type: 'pdf' as const,
        name: deduplicateName(name, parentId),
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
      await supabase.storage.from('user-files').remove([storagePath])
      console.error('PDF entry insert failed:', insertErr)
      throw new Error(insertErr?.message ?? 'Failed to add the PDF.')
    }

    entries.value.push(data)
    contentMap.set(data.id, '')
    sync.setBase(data.id, { version: data.version ?? null, content: '' })
    return data
  }

  /** Uploads a local PDF as a `pdf` entry (`{userId}/{entryId}.pdf`). Throws on failure. */
  async function uploadPdf(file: File, parentId: string | null = null): Promise<EntryRow | null> {
    if (!auth.user) return null
    requireOnline('Uploading a PDF')
    if (file.size > MAX_PDF_BYTES) throw new Error(`"${file.name}" is larger than the 50 MB limit.`)

    const bytes = await file.arrayBuffer()
    if (!hasPdfHeader(bytes)) throw new Error(`"${file.name}" is not a PDF.`)
    const info = await readPdfInfo(bytes)

    const entryId = crypto.randomUUID()
    const storagePath = `${auth.user.id}/${entryId}.pdf`
    const { error: uploadErr } = await supabase.storage
      .from('user-files')
      .upload(storagePath, file, { contentType: 'application/pdf' })
    if (uploadErr) throw uploadErr

    return insertPdfEntry(entryId, storagePath, pdfFileName(file.name), parentId, {
      source: 'upload',
      originalFilename: file.name,
      ...(info.title ? { title: info.title } : {}),
      pageCount: info.pageCount,
      importedAt: new Date().toISOString(),
    })
  }

  /**
   * Imports the PDF at `url` (fetched server-side into a signed upload URL). Returns null if the URL
   * isn't a PDF, so the caller can capture it as a web page instead. Throws on failure.
   */
  async function importPdfFromUrl(url: string, parentId: string | null = null) {
    if (!auth.user) return null
    requireOnline('Importing a PDF')

    const entryId = crypto.randomUUID()
    const storagePath = `${auth.user.id}/${entryId}.pdf`
    const { data: signed, error: signErr } = await supabase.storage
      .from('user-files')
      .createSignedUploadUrl(storagePath)
    if (signErr || !signed) throw signErr ?? new Error('Could not prepare the upload.')

    const result = await fetchPdfIntoStorage(url, signed.signedUrl)
    if (result.notPdf) return null

    const { data: blob, error: dlErr } = await supabase.storage
      .from('user-files')
      .download(storagePath)
    if (dlErr || !blob) {
      await supabase.storage.from('user-files').remove([storagePath])
      throw dlErr ?? new Error('Could not read the imported PDF.')
    }
    let info: { pageCount: number; title: string | null }
    try {
      info = await readPdfInfo(await blob.arrayBuffer())
    } catch {
      await supabase.storage.from('user-files').remove([storagePath])
      throw new Error('That file could not be read as a PDF.')
    }

    const name = info.title ?? result.filename ?? nameFromUrl(result.finalUrl)
    return insertPdfEntry(entryId, storagePath, pdfFileName(name), parentId, {
      source: 'url',
      url: result.finalUrl,
      ...(result.filename ? { originalFilename: result.filename } : {}),
      ...(info.title ? { title: info.title } : {}),
      pageCount: info.pageCount,
      importedAt: new Date().toISOString(),
    })
  }

  async function seedWelcomeFile() {
    // Only when the server itself reported no entries — never from an (empty) offline start.
    if (!auth.user || !serverLoaded || entries.value.length > 0) return

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

  /** On sign-out, so nothing leaks into the next session. */
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
    clearTimeout(snapshotTimer)
    serverLoaded = false
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
    refreshFromServer,
    patchEntry,
    getLatestText,
    applyMergedContent,
    createDocument,
    createDirectory,
    renameEntry,
    deleteEntry,
    moveEntry,
    collectDescendantIds,
    filterTopLevelIds,
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
    downloadPdf,
    uploadContent,
    uploadImage,
    getImageUrl,
    createWebDocument,
    uploadPdf,
    importPdfFromUrl,
    getEntry,
    seedWelcomeFile,
    $reset,
  }
})
