import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DocumentType } from '@/types/file-explorer'
import { useFilesStore } from './files'

export interface OpenDocument {
  id: string
  name: string
  type: DocumentType
  content: string
}

export const useEditorStore = defineStore('editor', () => {
  const openDocuments = ref(new Map<string, OpenDocument>())
  // Separate array so tabs can be reordered independently of insertion order
  const tabOrder = ref<string[]>([])
  const activeDocumentId = ref<string | null>(null)
  const activeDocument = ref<OpenDocument | null>(null)
  const dirtyIds = ref(new Set<string>())
  const savingIds = ref(new Set<string>())
  /** IDs of documents whose content is still being fetched from the network */
  const loadingIds = ref(new Set<string>())
  const scrollToLineRequest = ref<{ documentId: string; line: number } | null>(null)

  function requestScrollToLine(documentId: string, line: number) {
    scrollToLineRequest.value = { documentId, line }
  }

  function openDocument(id: string, name: string, type: DocumentType, initialContent = '') {
    if (!openDocuments.value.has(id)) {
      openDocuments.value.set(id, { id, name, type, content: initialContent })
      tabOrder.value.push(id)
    }
    dirtyIds.value.delete(id)
    loadingIds.value.delete(id)
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
  }

  /** Open a tab immediately (showing a loading skeleton) before content has arrived. */
  function openDocumentOptimistic(id: string, name: string, type: DocumentType) {
    if (!openDocuments.value.has(id)) {
      openDocuments.value.set(id, { id, name, type, content: '' })
      tabOrder.value.push(id)
    }
    loadingIds.value.add(id)
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
  }

  /** Called once content has finished loading; replaces skeleton with real content. */
  function finishLoadingDocument(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) doc.content = content
    loadingIds.value.delete(id)
    dirtyIds.value.delete(id)
  }

  function setActiveDocument(id: string) {
    if (openDocuments.value.has(id)) {
      activeDocumentId.value = id
      activeDocument.value = openDocuments.value.get(id) ?? null
    }
  }

  function updateContent(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) {
      doc.content = content
      dirtyIds.value.add(id)
    }
  }

  function closeDocument(id: string) {
    openDocuments.value.delete(id)
    dirtyIds.value.delete(id)
    const idx = tabOrder.value.indexOf(id)
    if (idx !== -1) tabOrder.value.splice(idx, 1)

    if (activeDocumentId.value === id) {
      // Prefer the tab that was to the left, fall back to right
      const nextId: string | null = tabOrder.value[Math.max(0, idx - 1)] ?? null
      activeDocumentId.value = nextId
      activeDocument.value = nextId ? (openDocuments.value.get(nextId) ?? null) : null
    }
  }

  async function saveDocument(id: string) {
    if (savingIds.value.has(id)) return
    const doc = openDocuments.value.get(id)
    if (!doc) return

    savingIds.value.add(id)
    const contentAtSaveStart = doc.content
    const filesStore = useFilesStore()
    const success = await filesStore.uploadContent(id, doc.content)
    savingIds.value.delete(id)

    if (success && doc.content === contentAtSaveStart) {
      dirtyIds.value.delete(id)
    }
  }

  function $reset() {
    openDocuments.value.clear()
    tabOrder.value = []
    activeDocumentId.value = null
    activeDocument.value = null
    dirtyIds.value.clear()
    savingIds.value.clear()
    loadingIds.value.clear()
    scrollToLineRequest.value = null
  }

  function moveTab(id: string, toIndex: number) {
    const from = tabOrder.value.indexOf(id)
    if (from === -1) return
    tabOrder.value.splice(from, 1)
    // toIndex was computed before the splice, so adjust if needed
    const adjustedTo = toIndex > from ? toIndex - 1 : toIndex
    tabOrder.value.splice(adjustedTo, 0, id)
  }

  return {
    openDocuments,
    tabOrder,
    activeDocumentId,
    activeDocument,
    dirtyIds,
    savingIds,
    loadingIds,
    openDocument,
    openDocumentOptimistic,
    finishLoadingDocument,
    setActiveDocument,
    updateContent,
    closeDocument,
    saveDocument,
    scrollToLineRequest,
    requestScrollToLine,
    $reset,
    moveTab,
  }
})
