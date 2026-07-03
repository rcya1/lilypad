// Pinia store for the multi-tab editor: open documents, tab ordering, dirty tracking, auto-save timers, and preview tabs.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DocumentType } from '@/types/file-explorer'
import { useFilesStore } from './files'
import { useToastStore } from './toast'

/** A document currently open in the editor. Content is the live (possibly unsaved) text. */
export interface OpenDocument {
  id: string
  name: string
  type: DocumentType
  content: string
}

export const useEditorStore = defineStore('editor', () => {
  // Map rather than array so O(1) lookup by ID is straightforward.
  const openDocuments = ref(new Map<string, OpenDocument>())
  // Separate from Map insertion order so tabs can be dragged into any position.
  const tabOrder = ref<string[]>([])
  const activeDocumentId = ref<string | null>(null)
  const activeDocument = ref<OpenDocument | null>(null)
  // IDs of documents with unsaved edits.
  const dirtyIds = ref(new Set<string>())
  // IDs of documents currently being uploaded to Supabase (prevents duplicate concurrent saves).
  const savingIds = ref(new Set<string>())
  /** Per-document debounce timers for auto-save (5 000 ms idle). Stored outside reactive state
   *  to avoid triggering Vue reactivity on every keystroke. */
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** IDs of documents whose content is still being fetched from the network (shows loading skeleton). */
  const loadingIds = ref(new Set<string>())

  /**
   * Pending request to scroll the CodeMirror editor to a specific line.
   * TextEditor watches this and clears it after executing the scroll,
   * so consumers should never need to clear it themselves.
   */
  const scrollToLineRequest = ref<{
    documentId: string
    line: number
    /** When true, also move the cursor to that line (used by preview block selection). */
    moveCursor?: boolean
  } | null>(null)

  /** Set to a documentId to ask the editor to cancel its current line-flash highlight. */
  const clearHighlightRequest = ref<string | null>(null)

  /** ID of the tab in preview (single-click) mode; replaced by the next single-clicked file. */
  const previewDocumentId = ref<string | null>(null)

  /** Current CodeMirror cursor line per document, updated on every cursor move. */
  const editorCursorLine = ref<Map<string, number>>(new Map())

  /** Source line of the last selected block in MarkdownPreview, per document. */
  const previewCursorLine = ref<Map<string, number>>(new Map())

  /** Which split-pane has keyboard focus; used to route Vim commands correctly. */
  const focusedPane = ref<'editor' | 'preview'>('editor')

  /**
   * Preview scroll offsets per document, saved when switching away so the position
   * is restored when switching back. Not reactive — no components need to watch it.
   */
  const previewScrollTop = new Map<string, number>()

  /** Asks TextEditor to scroll to the given 1-based line number in the named document. */
  function requestScrollToLine(documentId: string, line: number) {
    scrollToLineRequest.value = { documentId, line }
  }

  /** Asks TextEditor to cancel any active line-flash highlight for the named document. */
  function requestClearEditorHighlight(documentId: string) {
    clearHighlightRequest.value = documentId
  }

  /** Records the current editor cursor line for cross-pane sync. */
  function setEditorCursorLine(documentId: string, line: number) {
    editorCursorLine.value.set(documentId, line)
  }

  /**
   * Called when the user selects a block in the preview pane.
   * Stores the source line and enqueues a scroll request so the editor tracks the cursor.
   */
  function setPreviewCursor(documentId: string, line: number) {
    previewCursorLine.value.set(documentId, line)
    scrollToLineRequest.value = { documentId, line, moveCursor: true }
  }

  function setFocusedPane(pane: 'editor' | 'preview') {
    focusedPane.value = pane
  }

  /**
   * Opens a document as a permanent tab with its content already available.
   * If the document is already open, just activates it without re-adding.
   *
   * @param initialContent - Starting content; empty string is valid (e.g. a new blank file).
   */
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

  /**
   * Opens a tab immediately as a permanent tab while content is still loading.
   * Shows a loading skeleton in the editor until finishLoadingDocument() is called.
   *
   * Use instead of openDocument() when you need the tab to appear before the
   * network fetch completes (avoids a perceived delay on large files).
   */
  function openDocumentOptimistic(id: string, name: string, type: DocumentType) {
    if (!openDocuments.value.has(id)) {
      openDocuments.value.set(id, { id, name, type, content: '' })
      tabOrder.value.push(id)
    }
    loadingIds.value.add(id)
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
  }

  /**
   * Opens a document in preview (single-click) mode, replacing the current preview tab if any.
   *
   * Preview tabs behave like VSCode's preview: a single italic tab that is replaced when
   * another file is single-clicked. Double-clicking or editing promotes the tab to permanent.
   *
   * Short-circuits if the document is already open as either a preview or a permanent tab —
   * in that case it simply activates without changing the preview state.
   */
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

    // Replace the existing preview tab in-place so it stays in the same tab slot.
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

  /**
   * Like openDocumentAsPreview but shows a loading skeleton until finishLoadingDocument() is called.
   * Same replacement semantics as openDocumentAsPreview.
   */
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

  /**
   * Promotes a preview tab to a permanent tab (clears its preview status).
   * Called automatically when the user edits the document or double-clicks its tab.
   */
  function promotePreview(id: string) {
    if (previewDocumentId.value === id) {
      previewDocumentId.value = null
    }
  }

  /**
   * Replaces skeleton content with the real document content once the network fetch completes.
   * Clears the loading state and resets dirty so the just-loaded content isn't marked unsaved.
   *
   * Precondition: the document must already be open (added via openDocumentOptimistic or
   * openDocumentOptimisticAsPreview). This is a no-op if the document was closed before
   * the fetch finished.
   */
  function finishLoadingDocument(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) doc.content = content
    loadingIds.value.delete(id)
    dirtyIds.value.delete(id)
  }

  /**
   * Switches the active tab to an already-open document.
   * No-op if `id` is not in openDocuments (caller should check first or use openDocument).
   */
  function setActiveDocument(id: string) {
    if (openDocuments.value.has(id)) {
      activeDocumentId.value = id
      activeDocument.value = openDocuments.value.get(id) ?? null
    }
  }

  /**
   * Updates the live content for a document, marks it dirty, promotes any preview tab,
   * and resets the 5 000 ms idle auto-save debounce timer.
   *
   * The auto-save only fires if the document is still dirty when the timer expires —
   * so rapidly typing does not queue multiple concurrent saves.
   */
  function updateContent(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) {
      doc.content = content
      dirtyIds.value.add(id)
      // Editing a preview tab promotes it to permanent (mirrors VSCode behaviour).
      promotePreview(id)
      // Reset idle auto-save timer on every keystroke.
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

  /**
   * Saves any unsaved changes and then closes the document's tab.
   * After closing, activates the tab to the left (or right if leftmost).
   *
   * Awaits the save so the tab is not removed while a Supabase upload is in flight —
   * preventing data loss if the user closes the last dirty tab quickly.
   */
  async function closeDocument(id: string) {
    // Cancel any pending idle timer to avoid a ghost save after the tab is gone.
    const timer = saveTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      saveTimers.delete(id)
    }

    // Save before closing if there are unsaved changes.
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
      // Prefer the tab to the left; fall back to the right if this was the first tab.
      const nextId: string | null = tabOrder.value[Math.max(0, idx - 1)] ?? null
      activeDocumentId.value = nextId
      activeDocument.value = nextId ? (openDocuments.value.get(nextId) ?? null) : null
    }
  }

  /**
   * Uploads the current content of a document to Supabase.
   *
   * Guards against duplicate concurrent saves with `savingIds`. Snapshots the content
   * at save-start so that if the user keeps typing during the upload, the dirty flag
   * is only cleared if the content hasn't changed — avoiding a silent unsaved state.
   *
   * Postcondition: `dirtyIds` no longer contains `id` iff the save succeeded AND
   * no new edits arrived while the upload was in flight.
   */
  async function saveDocument(id: string) {
    // Saving always promotes a preview tab to permanent.
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
      // Content hasn't changed since we started — safe to clear the dirty flag.
      dirtyIds.value.delete(id)
    } else if (!success) {
      toastStore.addToast(`Failed to save ${doc.name}. Changes may be lost.`, 'error')
    }
    // If content changed mid-save, dirty flag remains so the next idle timer triggers another save.
  }

  /** Flushes all dirty documents immediately — used by the window beforeunload handler. */
  function saveAll() {
    for (const id of dirtyIds.value) {
      saveDocument(id)
    }
  }

  /** Tears down all state and pending timers. Called on sign-out. */
  function $reset() {
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

  /**
   * Moves a tab to a new position in the tab bar (drag-to-reorder).
   *
   * @param id      - ID of the tab to move.
   * @param toIndex - Target index in the tab bar, computed before the tab is removed.
   *
   * Note: toIndex is adjusted by -1 when the tab moves rightward because splicing out
   * the source shifts all subsequent indices down by one.
   */
  function moveTab(id: string, toIndex: number) {
    const from = tabOrder.value.indexOf(id)
    if (from === -1) return
    tabOrder.value.splice(from, 1)
    // toIndex was computed before the splice, so adjust if the tab moved right.
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
