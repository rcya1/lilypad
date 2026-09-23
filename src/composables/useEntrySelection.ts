// Shared multi-select state for tree rows (FileExplorerNode, ImageNode).
import { computed, type Ref } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { useFilesStore } from '@/stores/files'

export function useEntrySelection(entry: Ref<Entry>) {
  const filesStore = useFilesStore()

  const isSelected = computed(() => filesStore.selectedIds.has(entry.value.id))

  /**
   * True when an ancestor of this entry is in the multi-select set.
   * Covered entries act as selected for bulk delete/drag (preventing a subtree from being moved
   * twice) but aren't highlighted — only the explicitly selected row is.
   */
  const isCoveredBySelection = computed(() => {
    if (filesStore.selectedIds.size === 0) return false
    let parentId: string | null = entry.value.parentId
    while (parentId) {
      if (filesStore.selectedIds.has(parentId)) return true
      parentId = filesStore.getEntry(parentId)?.parent_id ?? null
    }
    return false
  })

  // Once ≥2 items are selected, single-clicking an entry adjusts the selection
  // instead of opening the document (to avoid accidentally navigating away).
  const inSelectionMode = computed(() => filesStore.selectedIds.size >= 2)

  return { isSelected, isCoveredBySelection, inSelectionMode }
}
