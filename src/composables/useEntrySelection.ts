// Multi-select state for tree rows (FileExplorerNode, ImageNode).
import { computed, type Ref } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { useFilesStore } from '@/stores/files'

export function useEntrySelection(entry: Ref<Entry>) {
  const filesStore = useFilesStore()

  const isSelected = computed(() => filesStore.selectedIds.has(entry.value.id))

  /**
   * An ancestor is selected. Counts as selected for bulk delete and drag (so a subtree isn't moved
   * twice), but isn't highlighted.
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

  // With 2+ selected, a click adjusts the selection instead of opening the document.
  const inSelectionMode = computed(() => filesStore.selectedIds.size >= 2)

  return { isSelected, isCoveredBySelection, inSelectionMode }
}
