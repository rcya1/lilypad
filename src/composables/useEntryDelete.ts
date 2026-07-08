// Shared delete flow for tree rows (FileExplorerNode, ImageNode): multi-select-aware
// confirm dialog, closing open tabs, then the store's bulkDelete/deleteEntry call.
import type { ComputedRef, Ref } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { useConfirm } from '@/composables/useConfirm'

export interface EntrySelectionRefs {
  isSelected: ComputedRef<boolean>
  isCoveredBySelection: ComputedRef<boolean>
}

export function useEntryDelete(
  entry: Ref<Entry>,
  sel: EntrySelectionRefs,
  options: {
    noun: string
    closeContextMenu: () => void
    /** Display name for the single-item confirm dialog; defaults to the raw entry name. */
    label?: (entry: Entry) => string
  },
) {
  const filesStore = useFilesStore()
  const editorStore = useEditorStore()
  const { confirm } = useConfirm()

  /**
   * Deletes this entry (or the full multi-select set if active) after a confirm dialog.
   *
   * When operating in multi-select mode, closes all affected tabs before deleting
   * to avoid dangling references in the editor store.
   */
  async function handleDelete() {
    options.closeContextMenu()

    const isInSelection = sel.isSelected.value || sel.isCoveredBySelection.value
    if (filesStore.selectedIds.size >= 2 && isInSelection) {
      const count = filesStore.selectedIds.size
      const ok = await confirm({
        title: `Delete ${count} items?`,
        message: 'These items will be permanently deleted.',
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      for (const id of filesStore.selectedIds) {
        await editorStore.closeDocument(id)
      }
      await filesStore.bulkDelete([...filesStore.selectedIds])
      return
    }

    const label = options.label ? options.label(entry.value) : entry.value.name
    const ok = await confirm({
      title: `Delete "${label}"?`,
      message: isDirectory(entry.value)
        ? 'This folder and all its contents will be permanently deleted.'
        : `This ${options.noun} will be permanently deleted.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await editorStore.closeDocument(entry.value.id)
    await filesStore.deleteEntry(entry.value.id)
  }

  return { handleDelete }
}
