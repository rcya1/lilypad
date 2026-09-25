<!-- Root: global shortcuts (Ctrl/Cmd+P, Ctrl/Cmd+N), unsaved-changes guard, route view. -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { isInstalledApp } from '@/lib/viewport'
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
const route = useRoute()

/**
 * VS Code-style tab shortcuts. Only in the installed app's editor: in a browser tab the browser keeps
 * these for itself.
 */
function onTabShortcut(e: KeyboardEvent): boolean {
  if (!isInstalledApp() || route.name !== 'app') return false
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()

  if (mod && !e.shiftKey && key === 'w') {
    // Even with no tab open, so it never closes the window.
    const id = editorStore.activeDocumentId
    if (id) void editorStore.closeDocument(id)
  } else if (mod && e.shiftKey && key === 't') {
    editorStore.reopenClosedTab()
  } else if (e.ctrlKey && key === 'tab') {
    editorStore.cycleTab(e.shiftKey ? -1 : 1)
  } else if (mod && (e.key === 'PageDown' || e.key === 'PageUp')) {
    editorStore.cycleTab(e.key === 'PageDown' ? 1 : -1)
  } else if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) {
    // e.code, since Alt+digit types other characters on macOS. 9 is the last tab.
    const n = Number(e.code.slice(5))
    const tabs = editorStore.tabOrder
    const id = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]
    if (!id) return false
    editorStore.setActiveDocument(id)
  } else {
    return false
  }
  e.preventDefault()
  if (editorStore.activeDocumentId) filesStore.selectSingle(editorStore.activeDocumentId)
  return true
}

function onKeyDown(e: KeyboardEvent) {
  if (onTabShortcut(e)) return

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
  // capture: so these win over CodeMirror's own bindings (Ctrl+P, Ctrl+N, Vim's Ctrl+W).
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
