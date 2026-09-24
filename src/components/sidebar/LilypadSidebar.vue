<!-- Main sidebar: drag-to-resize panel with file/images tabs, search toggle, settings, and sign-out. -->
<script setup lang="ts">
import FileExplorer from './FileExplorer.vue'
import ImagesTab from './ImagesTab.vue'
import SearchPanel from './SearchPanel.vue'
import BulkActionBar from './BulkActionBar.vue'
import SidebarHeader from './SidebarHeader.vue'
import SidebarFooter from './SidebarFooter.vue'
import SidebarResizeHandle from './SidebarResizeHandle.vue'
import { Loader2 } from 'lucide-vue-next'
import { watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useSearchStore } from '@/stores/search'
import { useUiStore } from '@/stores/ui'
import { useRouter } from 'vue-router'

const editorStore = useEditorStore()
const filesStore = useFilesStore()
const searchStore = useSearchStore()
const uiStore = useUiStore()
const router = useRouter()

// True whenever any document is currently being auto-saved to Supabase.
const isSyncing = computed(() => editorStore.savingIds.size > 0)

// Read/Edit switch → the reader, on the active document if there is one.
function openReader() {
  const entryId = editorStore.activeDocumentId
  uiStore.markModeSwitch('to-read')
  router.push(
    entryId ? { name: 'reader-document', params: { entryId } } : { name: 'reader-browser' },
  )
}

// Width + minimized live in the ui store so the reader's sidebar matches this one exactly.
const {
  sidebarWidth,
  sidebarMinimized: isMinimized,
  sidebarResizing: isResizing,
} = storeToRefs(uiStore)
// Icon-only width shown when minimized.
const minimizedWidth = 64

// When a pending file creation is triggered (e.g. via Ctrl+N), ensure the
// sidebar is visible so the inline input can be shown.
watch(
  () => filesStore.pendingCreate,
  (val) => {
    if (val) {
      if (isMinimized.value) isMinimized.value = false
      uiStore.sidebarTab = 'files'
    }
  },
)

/**
 * Global keyboard shortcuts handled at the sidebar level.
 * Ctrl/Cmd+B toggles sidebar visibility.
 * Ctrl/Cmd+Shift+F opens/closes the search panel (also un-minimizes the sidebar).
 */
function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault()
    isMinimized.value = !isMinimized.value
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
    e.preventDefault()
    searchStore.toggle()
    if (searchStore.isOpen && isMinimized.value) isMinimized.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div
    class="relative flex flex-col h-screen bg-surface border-r border-border-subtle shrink-0"
    :class="{ 'transition-[width] duration-200 ease-in-out': !isResizing }"
    :style="{ width: (isMinimized ? minimizedWidth : sidebarWidth) + 'px' }"
  >
    <SidebarHeader
      mode="edit"
      :minimized="isMinimized"
      :width="sidebarWidth"
      @switch="openReader"
      @search="searchStore.toggle()"
    >
      <Loader2
        v-if="isSyncing"
        :size="15"
        class="animate-spin text-text-muted shrink-0"
        title="Saving…"
      />
    </SidebarHeader>
    <div class="border-t border-border-subtle" />

    <div v-if="!isMinimized" class="relative flex-1 flex flex-col overflow-hidden">
      <SearchPanel v-if="searchStore.isOpen" />
      <template v-else>
        <div class="flex border-b border-border-subtle shrink-0">
          <button
            v-for="tab in ['files', 'images'] as const"
            :key="tab"
            class="flex-1 text-xs font-medium py-1.5 text-center capitalize transition-colors duration-100 cursor-pointer relative"
            :class="
              uiStore.sidebarTab === tab
                ? 'text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            "
            @click="uiStore.sidebarTab = tab"
          >
            {{ tab }}
            <div
              v-if="uiStore.sidebarTab === tab"
              class="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full"
            />
          </button>
        </div>
        <FileExplorer v-if="uiStore.sidebarTab === 'files'" />
        <ImagesTab v-else />
      </template>
      <BulkActionBar />
    </div>

    <SidebarFooter v-if="!isMinimized" />

    <SidebarResizeHandle />
  </div>
</template>
