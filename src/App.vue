<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import ToastContainer from '@/components/ToastContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const auth = useAuthStore()
const filesStore = useFilesStore()
const editorStore = useEditorStore()

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    // If a rename/input is already active, do nothing
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return

    e.preventDefault()

    // Resolve target folder: selectedFolderId → parent of active tab → root
    let targetFolderId: string | null = filesStore.selectedFolderId
    if (targetFolderId === null && editorStore.activeDocumentId) {
      targetFolderId = filesStore.getParentFolderId(editorStore.activeDocumentId)
    }

    filesStore.beginCreate('document', targetFolderId)
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (editorStore.dirtyIds.size > 0 || editorStore.savingIds.size > 0) {
    e.preventDefault()
    e.returnValue = ''
  }
  editorStore.saveAll()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown, { capture: true })
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, { capture: true })
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<template>
  <div v-if="auth.loading" class="flex items-center justify-center h-screen bg-bg">
    <div class="text-text-muted text-sm font-ui">Loading...</div>
  </div>
  <router-view v-else />
  <ToastContainer />
  <ConfirmDialog />
</template>
