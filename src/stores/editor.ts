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
  const activeDocumentId = ref<string | null>(null)

  const activeDocument = ref<OpenDocument | null>(null)

  function openDocument(id: string, name: string, type: DocumentType, initialContent = '') {
    if (!openDocuments.value.has(id)) {
      openDocuments.value.set(id, { id, name, type, content: initialContent })
    }
    activeDocumentId.value = id
    activeDocument.value = openDocuments.value.get(id) ?? null
  }

  function updateContent(id: string, content: string) {
    const doc = openDocuments.value.get(id)
    if (doc) {
      doc.content = content
    }
  }

  function closeDocument(id: string) {
    openDocuments.value.delete(id)
    if (activeDocumentId.value === id) {
      const remaining = [...openDocuments.value.keys()]
      const nextId: string | null =
        remaining.length > 0 ? (remaining[remaining.length - 1] as string) : null
      activeDocumentId.value = nextId
      activeDocument.value = nextId ? (openDocuments.value.get(nextId) ?? null) : null
    }
  }

  return {
    openDocuments,
    activeDocumentId,
    activeDocument,
    openDocument,
    updateContent,
    closeDocument,
  }
})
