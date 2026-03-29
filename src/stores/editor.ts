import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DocumentType } from '@/types/file-explorer'
import { useFilesStore } from './files'
import { useToastStore } from './toast'

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
  /** Per-document debounce timers for auto-save (1500 ms idle) */
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** IDs of documents whose content is still being fetched from the network */
  const loadingIds = ref(new Set<string>())
  const scrollToLineRequest = ref<{ documentId: string; line: number; moveCursor?: boolean } | null>(null)
  /** Set to a documentId to ask the editor to immediately cancel its line-flash highlight */
  const clearHighlightRequest = ref<string | null>(null)
  /** ID of the tab currently in preview (single-click) mode; null if none */
  const previewDocumentId = ref<string | null>(null)

  /** Current editor cursor line, per document */
  const editorCursorLine = ref<Map<string, number>>(new Map())

  /** Source line of the currently selected block in the preview, per document */
  const previewCursorLine = ref<Map<string, number>>(new Map())

  /** Which pane has focus: 'editor' or 'preview' */
  const focusedPane = ref<'editor' | 'preview'>('editor')

  /** Saved preview scroll positions, per document */
  const previewScrollTop = new Map<string, number>()

  function requestScrollToLine(documentId: string, line: number) {
    scrollToLineRequest.value = { documentId, line }
  }

  function requestClearEditorHighlight(documentId: string) {
    clearHighlightRequest.value = documentId
  }

  function setEditorCursorLine(documentId: string, line: number) {
    editorCursorLine.value.set(documentId, line)
  }

  function setPreviewCursor(documentId: string, line: number) {
    previewCursorLine.value.set(documentId, line)
    scrollToLineRequest.value = { documentId, line, moveCursor: true }
  }

  function setFocusedPane(pane: 'editor' | 'preview') {
    focusedPane.value = pane
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

  /** Open a file as a preview tab, replacing the existing preview tab if any. */
  function openDocumentAsPreview(id: string, name: string, type: DocumentType, content: string) {
    // Already the preview — just activate
    if (previewDocumentId.value === id) {
      activeDocumentId.value = id
      activeDocument.value = openDocuments.value.get(id) ?? null
      return
    }
    // Already a permanent tab — just activate, don't convert to preview
    if (openDocuments.value.has(id) && previewDocumentId.value !== id) {
      activeDocumentId.value = id
      activeDocument.value = openDocuments.value.get(id) ?? null
      return
    }

    // Replace the existing preview tab in-place
    let insertIndex = tabOrder.value.length
    if (previewDocumentId.value) {
      const oldId = previewDocumentId.value
      insertIndex = tabOrder.value.indexOf(oldId)
      openDocuments.value.delete(oldId)
      dirtyIds.value.delete(oldId)
      loadingIds.value.delete(oldId)
      tabOrder.value.splice(insertIndex, 1)
    }

    openDocuments.value.set(id, { id, name, type, content })
    tabOrder.value.splice(insertIndex, 0, id)
    previewDocumentId.value = id
    dirtyIds.value.delete(id)
    loadingIds.value.delete(id)
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
  }

  /** Optimistic preview open: shows skeleton immediately, call finishLoadingDocument when ready. */
  function openDocumentOptimisticAsPreview(id: string, name: string, type: DocumentType) {
    if (previewDocumentId.value === id) {
      activeDocumentId.value = id
      activeDocument.value = openDocuments.value.get(id) ?? null
      return
    }
    if (openDocuments.value.has(id) && previewDocumentId.value !== id) {
      activeDocumentId.value = id
      activeDocument.value = openDocuments.value.get(id) ?? null
      return
    }

    let insertIndex = tabOrder.value.length
    if (previewDocumentId.value) {
      const oldId = previewDocumentId.value
      insertIndex = tabOrder.value.indexOf(oldId)
      openDocuments.value.delete(oldId)
      dirtyIds.value.delete(oldId)
      loadingIds.value.delete(oldId)
      tabOrder.value.splice(insertIndex, 1)
    }

    openDocuments.value.set(id, { id, name, type, content: '' })
    tabOrder.value.splice(insertIndex, 0, id)
    previewDocumentId.value = id
    loadingIds.value.add(id)
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
  }

  /** Promote a preview tab to a permanent tab. */
  function promotePreview(id: string) {
    if (previewDocumentId.value === id) {
      previewDocumentId.value = null
    }
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
      // Editing a preview tab promotes it to permanent (like VSCode)
      promotePreview(id)
      // Reset idle auto-save timer
      const existing = saveTimers.get(id)
      if (existing !== undefined) clearTimeout(existing)
      saveTimers.set(
        id,
        setTimeout(() => {
          saveTimers.delete(id)
          if (dirtyIds.value.has(id)) saveDocument(id)
        }, 5000),
      )
    }
  }

  async function closeDocument(id: string) {
    // Cancel any pending idle timer for this document
    const timer = saveTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      saveTimers.delete(id)
    }

    // Save before closing if there are unsaved changes
    if (dirtyIds.value.has(id)) {
      await saveDocument(id)
    }

    if (previewDocumentId.value === id) previewDocumentId.value = null
    openDocuments.value.delete(id)
    dirtyIds.value.delete(id)
    editorCursorLine.value.delete(id)
    previewCursorLine.value.delete(id)
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
    // Saving always promotes a preview tab to permanent
    promotePreview(id)
    if (savingIds.value.has(id)) return
    const doc = openDocuments.value.get(id)
    if (!doc) return

    savingIds.value.add(id)
    const contentAtSaveStart = doc.content
    const filesStore = useFilesStore()
    const toastStore = useToastStore()
    const success = await filesStore.uploadContent(id, doc.content)
    savingIds.value.delete(id)

    if (success && doc.content === contentAtSaveStart) {
      dirtyIds.value.delete(id)
    } else if (!success) {
      toastStore.addToast(`Failed to save ${doc.name}. Changes may be lost.`, 'error')
    }
  }

  /** Save all dirty documents — used by the beforeunload handler. */
  function saveAll() {
    for (const id of dirtyIds.value) {
      saveDocument(id)
    }
  }

  function $reset() {
    // Clear all pending auto-save timers
    for (const timer of saveTimers.values()) clearTimeout(timer)
    saveTimers.clear()
    openDocuments.value.clear()
    tabOrder.value = []
    activeDocumentId.value = null
    activeDocument.value = null
    dirtyIds.value.clear()
    savingIds.value.clear()
    loadingIds.value.clear()
    previewDocumentId.value = null
    scrollToLineRequest.value = null
    editorCursorLine.value.clear()
    previewCursorLine.value.clear()
    focusedPane.value = 'editor'
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
    previewDocumentId,
    openDocument,
    openDocumentOptimistic,
    openDocumentAsPreview,
    openDocumentOptimisticAsPreview,
    promotePreview,
    finishLoadingDocument,
    setActiveDocument,
    updateContent,
    closeDocument,
    saveDocument,
    saveAll,
    scrollToLineRequest,
    requestScrollToLine,
    clearHighlightRequest,
    requestClearEditorHighlight,
    editorCursorLine,
    setEditorCursorLine,
    previewCursorLine,
    focusedPane,
    previewScrollTop,
    setPreviewCursor,
    setFocusedPane,
    $reset,
    moveTab,
  }
})
