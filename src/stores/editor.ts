// Pinia store for the tabbed editor: open documents, tab order, dirty state, autosave.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DocumentType } from '@/types/file-explorer'
import { useFilesStore } from './files'
import { useToastStore } from './toast'

/** `content` is the live, possibly unsaved text. */
export interface OpenDocument {
  id: string
  name: string
  type: DocumentType
  content: string
}

export const useEditorStore = defineStore('editor', () => {
  const openDocuments = ref(new Map<string, OpenDocument>())
  // Separate from Map insertion order so tabs can be dragged into any position.
  const tabOrder = ref<string[]>([])
  const activeDocumentId = ref<string | null>(null)
  const activeDocument = computed<OpenDocument | null>(() =>
    activeDocumentId.value ? (openDocuments.value.get(activeDocumentId.value) ?? null) : null,
  )
  const dirtyIds = ref(new Set<string>())
  // Guards against concurrent saves of the same document.
  const savingIds = ref(new Set<string>())
  // Autosave debounce timers. Not reactive, to keep keystrokes cheap.
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Still fetching content (the tab shows a skeleton).
  const loadingIds = ref(new Set<string>())

  /** Consumed and cleared by TextEditor, like the other *Request refs below. */
  const scrollToLineRequest = ref<{
    documentId: string
    line: number
    /** Also move the cursor there (preview block selection). */
    moveCursor?: boolean
  } | null>(null)

  const clearHighlightRequest = ref<string | null>(null)

  /** From web annotations' "insert reference": text to insert at the cursor. */
  const insertTextRequest = ref<{ documentId: string; text: string } | null>(null)

  /**
   * Text replaced from outside the editor (a sync merge, newer server text). Applied as a minimal
   * edit that doesn't count as typing, so the tab isn't marked dirty.
   */
  const externalContentRequest = ref<{ documentId: string; content: string } | null>(null)

  /** The single-click preview tab, replaced by the next single-clicked file. */
  const previewDocumentId = ref<string | null>(null)

  const editorCursorLine = ref<Map<string, number>>(new Map())

  /** Source line of the block last selected in the preview. */
  const previewCursorLine = ref<Map<string, number>>(new Map())

  /** Routes Vim commands. */
  const focusedPane = ref<'editor' | 'preview'>('editor')

  /** Restored when switching back to a tab. Not reactive; nothing watches it. */
  const previewScrollTop = new Map<string, number>()

  // Most recent last, for reopening closed tabs.
  const closedTabs: string[] = []
  const MAX_CLOSED_TABS = 20

  function requestScrollToLine(documentId: string, line: number) {
    scrollToLineRequest.value = { documentId, line }
  }

  function requestClearEditorHighlight(documentId: string) {
    clearHighlightRequest.value = documentId
  }

  function applyExternalContent(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (!doc || doc.content === content) return
    doc.content = content
    externalContentRequest.value = { documentId: id, content }
  }

  function requestInsertText(documentId: string, text: string) {
    insertTextRequest.value = { documentId, text }
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

  /**
   * `preview` takes over the current preview tab's slot (VS Code style); `loading` shows a skeleton
   * until finishLoadingDocument().
   */
  function openDocumentInternal(
    id: string,
    name: string,
    type: DocumentType,
    {
      content = '',
      preview = false,
      loading = false,
    }: {
      content?: string
      preview?: boolean
      loading?: boolean
    } = {},
  ) {
    // Already open (as this preview or as a permanent tab): just activate.
    if (openDocuments.value.has(id)) {
      activeDocumentId.value = id
      return
    }

    let insertIndex = tabOrder.value.length
    if (preview && previewDocumentId.value) {
      // Take over the old preview tab's slot.
      const oldId = previewDocumentId.value
      insertIndex = tabOrder.value.indexOf(oldId)
      openDocuments.value.delete(oldId)
      dirtyIds.value.delete(oldId)
      loadingIds.value.delete(oldId)
      tabOrder.value.splice(insertIndex, 1)
    }

    openDocuments.value.set(id, { id, name, type, content })
    tabOrder.value.splice(insertIndex, 0, id)
    if (preview) previewDocumentId.value = id

    dirtyIds.value.delete(id)
    if (loading) loadingIds.value.add(id)
    else loadingIds.value.delete(id)
    activeDocumentId.value = id
  }

  function openDocument(id: string, name: string, type: DocumentType, initialContent = '') {
    openDocumentInternal(id, name, type, { content: initialContent })
  }

  /** Shows the tab (with a skeleton) before the content has loaded. */
  function openDocumentOptimistic(id: string, name: string, type: DocumentType) {
    openDocumentInternal(id, name, type, { loading: true })
  }

  function openDocumentAsPreview(id: string, name: string, type: DocumentType, content: string) {
    openDocumentInternal(id, name, type, { content, preview: true })
  }

  function openDocumentOptimisticAsPreview(id: string, name: string, type: DocumentType) {
    openDocumentInternal(id, name, type, { preview: true, loading: true })
  }

  /** Editing or double-clicking a preview tab makes it permanent. */
  function promotePreview(id: string) {
    if (previewDocumentId.value === id) {
      previewDocumentId.value = null
    }
  }

  /** No-op if the tab was closed before the fetch finished. */
  function finishLoadingDocument(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) doc.content = content
    loadingIds.value.delete(id)
    dirtyIds.value.delete(id)
  }

  function setActiveDocument(id: string) {
    if (openDocuments.value.has(id)) {
      activeDocumentId.value = id
    }
  }

  /**
   * Opens an entry from anywhere (sidebar, quick switcher, search, image pane). Cached content
   * opens at once; otherwise the tab shows a skeleton until the fetch lands.
   */
  async function openEntry(id: string, { preview = false }: { preview?: boolean } = {}) {
    const filesStore = useFilesStore()
    const entry = filesStore.getEntry(id)
    if (!entry || entry.kind !== 'document' || !entry.document_type) return

    const type = entry.document_type

    // Images have no text content; the ImageDetailPane loads the blob itself.
    if (type === 'image') {
      openDocumentInternal(id, entry.name, type, {})
      return
    }

    // Already open as a permanent tab: just activate (don't demote to preview).
    if (openDocuments.value.has(id) && previewDocumentId.value !== id) {
      setActiveDocument(id)
      return
    }

    const cached = filesStore.getCached(id)
    if (cached !== undefined) {
      openDocumentInternal(id, entry.name, type, { content: cached, preview })
      return
    }

    openDocumentInternal(id, entry.name, type, { preview, loading: true })
    const content = await filesStore.downloadContent(id)
    finishLoadingDocument(id, content ?? '')
  }

  /** Marks dirty and restarts the 5s idle autosave. */
  function updateContent(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) {
      doc.content = content
      dirtyIds.value.add(id)
      promotePreview(id)
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

  /** Saves first so a quick close can't drop edits, then activates the tab to the left. */
  async function closeDocument(id: string) {
    // Cancel the idle timer so it doesn't fire after the tab is gone.
    const timer = saveTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      saveTimers.delete(id)
    }

    if (dirtyIds.value.has(id)) {
      await saveDocument(id)
    }

    if (previewDocumentId.value === id) previewDocumentId.value = null
    if (openDocuments.value.has(id)) {
      const previous = closedTabs.indexOf(id)
      if (previous !== -1) closedTabs.splice(previous, 1)
      closedTabs.push(id)
      if (closedTabs.length > MAX_CLOSED_TABS) closedTabs.shift()
    }
    openDocuments.value.delete(id)
    dirtyIds.value.delete(id)
    editorCursorLine.value.delete(id)
    previewCursorLine.value.delete(id)
    const idx = tabOrder.value.indexOf(id)
    if (idx !== -1) tabOrder.value.splice(idx, 1)

    if (activeDocumentId.value === id) {
      // Prefer the tab to the left; fall back to the right if this was the first tab.
      const nextId: string | null = tabOrder.value[Math.max(0, idx - 1)] ?? null
      activeDocumentId.value = nextId
    }
  }

  /** Reopens the most recently closed tab whose entry still exists. */
  function reopenClosedTab() {
    const files = useFilesStore()
    while (closedTabs.length > 0) {
      const id = closedTabs.pop()!
      if (files.getEntry(id)) {
        void openEntry(id)
        return
      }
    }
  }

  /** Activates the tab `step` places away from the active one, wrapping around. */
  function cycleTab(step: number) {
    const count = tabOrder.value.length
    if (count === 0) return
    const current = activeDocumentId.value ? tabOrder.value.indexOf(activeDocumentId.value) : -1
    setActiveDocument(tabOrder.value[(((current + step) % count) + count) % count]!)
  }

  /** Stays dirty if anything was typed during the upload, so the next idle timer saves again. */
  async function saveDocument(id: string) {
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

  /** For the beforeunload handler. */
  function saveAll() {
    for (const id of dirtyIds.value) {
      saveDocument(id)
    }
  }

  /** On sign-out. */
  function $reset() {
    for (const timer of saveTimers.values()) clearTimeout(timer)
    saveTimers.clear()
    openDocuments.value.clear()
    tabOrder.value = []
    activeDocumentId.value = null
    dirtyIds.value.clear()
    savingIds.value.clear()
    loadingIds.value.clear()
    previewDocumentId.value = null
    scrollToLineRequest.value = null
    editorCursorLine.value.clear()
    previewCursorLine.value.clear()
    focusedPane.value = 'editor'
  }

  /** `toIndex` is measured before the tab is removed. */
  function moveTab(id: string, toIndex: number) {
    const from = tabOrder.value.indexOf(id)
    if (from === -1) return
    tabOrder.value.splice(from, 1)
    // toIndex was computed before the splice, so adjust if the tab moved right.
    const adjustedTo = toIndex > from ? toIndex - 1 : toIndex
    tabOrder.value.splice(adjustedTo, 0, id)
  }

  return {
    reopenClosedTab,
    cycleTab,
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
    openEntry,
    updateContent,
    closeDocument,
    saveDocument,
    saveAll,
    scrollToLineRequest,
    requestScrollToLine,
    clearHighlightRequest,
    requestClearEditorHighlight,
    insertTextRequest,
    externalContentRequest,
    applyExternalContent,
    requestInsertText,
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
