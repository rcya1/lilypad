import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import type { EntryRow } from '@/types/database'
import type { Entry } from '@/types/file-explorer'
import type { DocumentType } from '@/types/file-explorer'

export const useFilesStore = defineStore('files', () => {
  const auth = useAuthStore()
  const entries = ref<EntryRow[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedFolderId = ref<string | null>(null)
  const pendingCreate = ref<{
    parentId: string | null
    type: 'file' | 'folder'
    insertBefore: string | null // null = append to end
  } | null>(null)

  const tree = computed<Entry[]>(() => buildTree(null))

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
    error.value = null

    const { data, error: err } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('sort_order')
      .returns<EntryRow[]>()

    if (err) {
      error.value = err.message
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
      error.value = err?.message ?? 'Failed to create document'
      return null
    }

    const ext = type === 'pdf' ? 'pdf' : 'md'
    const storagePath = `${auth.user.id}/${data.id}.${ext}`

    await supabase.storage
      .from('user-files')
      .upload(storagePath, new Blob([''], { type: 'text/plain' }))

    await supabase
      .from('entries')
      .update({ storage_path: storagePath } as never)
      .eq('id', data.id)

    data.storage_path = storagePath
    entries.value.push(data)
    return data
  }

  async function createDirectory(
    name: string,
    parentId: string | null = null,
    sortOrder?: number,
  ) {
    if (!auth.user) return null

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
      error.value = err?.message ?? 'Failed to create directory'
      return null
    }

    entries.value.push(data)
    return data
  }

  async function renameEntry(id: string, newName: string) {
    const { error: err } = await supabase
      .from('entries')
      .update({ name: newName } as never)
      .eq('id', id)

    if (err) {
      error.value = err.message
      return false
    }

    const entry = entries.value.find((e) => e.id === id)
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
      error.value = err.message
      return false
    }

    entries.value = entries.value.filter((e) => !idsToDelete.includes(e.id))

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
  ): Promise<boolean> {
    const descendants = collectDescendantIds(id)
    if (newParentId !== null && descendants.includes(newParentId)) return false

    const { error: err } = await supabase
      .from('entries')
      .update({ parent_id: newParentId, sort_order: newSortOrder } as never)
      .eq('id', id)

    if (err) {
      error.value = err.message
      return false
    }

    const entry = entries.value.find((e) => e.id === id)
    if (entry) {
      entry.parent_id = newParentId
      entry.sort_order = newSortOrder
    }
    return true
  }

  async function downloadContent(entryId: string): Promise<string | null> {
    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry?.storage_path) return null

    const { data, error: err } = await supabase.storage
      .from('user-files')
      .download(entry.storage_path)

    if (err) {
      error.value = err.message
      return null
    }

    return await data.text()
  }

  async function uploadContent(entryId: string, content: string): Promise<boolean> {
    const entry = entries.value.find((e) => e.id === entryId)
    if (!entry?.storage_path) return false

    const { error: err } = await supabase.storage
      .from('user-files')
      .update(entry.storage_path, new Blob([content], { type: 'text/plain' }), { upsert: true })

    if (err) {
      error.value = err.message
      return false
    }

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
    error.value = null
    selectedFolderId.value = null
    pendingCreate.value = null
  }

  return {
    entries,
    tree,
    loading,
    error,
    selectedFolderId,
    pendingCreate,
    fetchEntries,
    createDocument,
    createDirectory,
    renameEntry,
    deleteEntry,
    moveEntry,
    collectDescendantIds,
    selectFolder,
    triggerCreate,
    updatePendingPosition,
    getPendingSortOrder,
    clearPendingCreate,
    downloadContent,
    uploadContent,
    seedWelcomeFile,
    $reset,
  }
})
