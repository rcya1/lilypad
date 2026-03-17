<script setup lang="ts">
import { computed, ref } from 'vue'
import { Trash2, FolderInput } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { useToastStore } from '@/stores/toast'
import { useConfirm } from '@/composables/useConfirm'
import FolderPickerModal from './FolderPickerModal.vue'

const filesStore = useFilesStore()
const editorStore = useEditorStore()
const toast = useToastStore()
const { confirm } = useConfirm()

const showMoveModal = ref(false)
const count = computed(() => filesStore.selectedIds.size)

async function handleDelete() {
  const ids = [...filesStore.selectedIds]
  const ok = await confirm({
    title: `Delete ${ids.length} files?`,
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return

  // Close any open tabs first
  for (const id of ids) {
    editorStore.closeDocument(id)
  }

  const success = await filesStore.bulkDelete(ids)
  if (!success) toast.addToast('Failed to delete some files.', 'error')
}

async function handleMove(targetFolderId: string | null) {
  showMoveModal.value = false
  const ids = [...filesStore.selectedIds]
  const success = await filesStore.bulkMove(ids, targetFolderId)
  if (!success) toast.addToast('Failed to move some files.', 'error')
}
</script>

<template>
  <div
    v-if="count >= 2"
    class="absolute bottom-0 left-0 right-0 bg-surface border-t border-border px-3 py-2 flex items-center gap-2 z-20"
  >
    <span class="flex-1 text-xs text-text-secondary">{{ count }} selected</span>

    <button
      class="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded transition-colors duration-75 cursor-pointer"
      title="Move to folder"
      @click="showMoveModal = true"
    >
      <FolderInput :size="14" />
      Move
    </button>

    <button
      class="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-surface-elevated rounded transition-colors duration-75 cursor-pointer"
      title="Delete selected files"
      @click="handleDelete"
    >
      <Trash2 :size="14" />
      Delete
    </button>
  </div>

  <FolderPickerModal v-if="showMoveModal" @confirm="handleMove" @cancel="showMoveModal = false" />
</template>
