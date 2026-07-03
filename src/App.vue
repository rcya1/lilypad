<!-- Root component: global keyboard shortcuts (Cmd+P, Cmd+N), beforeunload guard for unsaved docs, and auth-gated route rendering. -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import ToastContainer from '@/components/ToastContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import QuickSwitcher from '@/components/QuickSwitcher.vue'

const auth = useAuthStore()
const filesStore = useFilesStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

function onKeyDown(e: KeyboardEvent) {
  // Ctrl/Cmd+P: toggle the quick switcher (works regardless of focus)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    if (uiStore.quickSwitcherOpen) uiStore.closeQuickSwitcher()
    else uiStore.openQuickSwitcher()
    return
  }

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
  // capture: true ensures we intercept before the editor (CodeMirror) handles Ctrl+P/Ctrl+N.
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
  <QuickSwitcher />
  <ToastContainer />
  <ConfirmDialog />
</template>
