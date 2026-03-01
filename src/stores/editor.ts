import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DocumentType } from '@/types/file-explorer'

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

  function openDocument(id: string, name: string, type: DocumentType, initialContent = '') {
    if (!openDocuments.value.has(id)) {
      openDocuments.value.set(id, { id, name, type, content: initialContent })
      tabOrder.value.push(id)
    }
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
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
    }
  }

  function closeDocument(id: string) {
    openDocuments.value.delete(id)
    const idx = tabOrder.value.indexOf(id)
    if (idx !== -1) tabOrder.value.splice(idx, 1)

    if (activeDocumentId.value === id) {
      // Prefer the tab that was to the left, fall back to right
      const nextId: string | null = tabOrder.value[Math.max(0, idx - 1)] ?? null
      activeDocumentId.value = nextId
      activeDocument.value = nextId ? (openDocuments.value.get(nextId) ?? null) : null
    }
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
    openDocument,
    setActiveDocument,
    updateContent,
    closeDocument,
    moveTab,
  }
})
