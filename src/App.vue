<!-- Root: global shortcuts (Ctrl/Cmd+P, Ctrl/Cmd+N), unsaved-changes guard, route view. -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { useUiStore } from '@/stores/ui'
import ToastContainer from '@/components/ToastContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import QuickSwitcher from '@/components/QuickSwitcher.vue'
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt.vue'

const auth = useAuthStore()
const filesStore = useFilesStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    if (uiStore.quickSwitcherOpen) uiStore.closeQuickSwitcher()
    else uiStore.openQuickSwitcher()
    return
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    // Not while typing in an input.
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return

    e.preventDefault()

    // Selected folder, else the active tab's folder, else the top level.
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
  // Best-effort: the browser may kill these async saves. The prompt above is the real safety net.
  editorStore.saveAll()
}

onMounted(() => {
  // capture: so these win over CodeMirror's own Ctrl+P/Ctrl+N.
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
  <PwaUpdatePrompt />
</template>
