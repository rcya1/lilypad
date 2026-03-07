import { ref, computed, type Ref } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import type { useFilesStore } from '@/stores/files'

type FilesStore = ReturnType<typeof useFilesStore>

// Sentinel ID used when dragging the pending creation row
export const PENDING_ID = '__pending__'

// Module-level: shared across all node instances so only one drag is active at a time
export const draggingEntry = ref<Entry | null>(null)

export function useDragDrop(entryRef: Ref<Entry>, isOpen: Ref<boolean>, filesStore: FilesStore) {
  const dropRegion = ref<'before' | 'into' | 'after' | null>(null)
  let hoverTimer: ReturnType<typeof setTimeout> | null = null

  const isInvalidTarget = computed(() => {
    if (!draggingEntry.value) return false
    if (draggingEntry.value.id === PENDING_ID) return false // pending row can go anywhere
    const entry = entryRef.value
    if (draggingEntry.value.id === entry.id) return true
    if (isDirectory(entry)) {
      return filesStore.collectDescendantIds(draggingEntry.value.id).includes(entry.id)
    }
    return false
  })

  function onDragStart(e: DragEvent) {
    draggingEntry.value = entryRef.value
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragEnd() {
    draggingEntry.value = null
    dropRegion.value = null
    clearHoverTimer()
  }

  function clearHoverTimer() {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
  }

  function onDragOver(e: DragEvent) {
    if (!draggingEntry.value) return
    e.preventDefault()

    const entry = entryRef.value

    if (draggingEntry.value.id === entry.id) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
      dropRegion.value = null
      clearHoverTimer()
      return
    }

    const target = e.currentTarget as HTMLElement
    const ratio = e.offsetY / target.offsetHeight

    let region: 'before' | 'into' | 'after'
    if (ratio < 0.3) {
      region = 'before'
    } else if (ratio >= 0.7) {
      region = 'after'
    } else {
      region = isDirectory(entry) ? 'into' : ratio < 0.5 ? 'before' : 'after'
    }

    // Guard: can't drop a real entry into its own descendant
    if (region === 'into' && draggingEntry.value.id !== PENDING_ID) {
      const descendants = filesStore.collectDescendantIds(draggingEntry.value.id)
      if (descendants.includes(entry.id)) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
        dropRegion.value = null
        clearHoverTimer()
        return
      }
    }

    if (region === 'into') {
      if (hoverTimer === null) {
        hoverTimer = setTimeout(() => {
          isOpen.value = true
          hoverTimer = null
        }, 700)
      }
    } else {
      clearHoverTimer()
    }

    dropRegion.value = region
  }

  function onDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement
    if (e.relatedTarget && target.contains(e.relatedTarget as Node)) return
    dropRegion.value = null
    clearHoverTimer()
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const region = dropRegion.value
    dropRegion.value = null
    clearHoverTimer()

    if (!draggingEntry.value || !region) return

    const targetEntry = entryRef.value
    const dragId = draggingEntry.value.id
    draggingEntry.value = null

    if (dragId === targetEntry.id) return

    // Handle pending creation row being repositioned
    if (dragId === PENDING_ID) {
      const siblings = filesStore.entries
        .filter((e) => e.parent_id === targetEntry.parentId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      const idx = siblings.findIndex((s) => s.id === targetEntry.id)

      let newParentId: string | null
      let insertBefore: string | null

      if (region === 'into') {
        newParentId = targetEntry.id
        insertBefore = null
        isOpen.value = true
      } else if (region === 'before') {
        newParentId = targetEntry.parentId
        insertBefore = targetEntry.id
      } else {
        newParentId = targetEntry.parentId
        insertBefore = idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1]!.id : null
      }

      filesStore.updatePendingPosition(newParentId, insertBefore)
      return
    }

    // Normal entry move
    let newParentId: string | null
    let newSortOrder: number

    if (region === 'into') {
      newParentId = targetEntry.id
      const siblings = filesStore.entries
        .filter((e) => e.parent_id === targetEntry.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      newSortOrder =
        siblings.length === 0 ? 1000 : Math.max(...siblings.map((e) => e.sort_order)) + 1000
      isOpen.value = true
    } else {
      newParentId = targetEntry.parentId
      const siblings = filesStore.entries
        .filter((e) => e.parent_id === targetEntry.parentId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      const idx = siblings.findIndex((s) => s.id === targetEntry.id)
      if (idx === -1) return

      const cur = siblings[idx]!.sort_order
      if (region === 'before') {
        const prevOrder = idx > 0 ? siblings[idx - 1]!.sort_order : cur - 1000
        newSortOrder = (prevOrder + cur) / 2
      } else {
        const nextOrder = idx < siblings.length - 1 ? siblings[idx + 1]!.sort_order : cur + 1000
        newSortOrder = (cur + nextOrder) / 2
      }
    }

    filesStore.moveEntry(dragId, newParentId, newSortOrder)
  }

  return { dropRegion, isInvalidTarget, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }
}
