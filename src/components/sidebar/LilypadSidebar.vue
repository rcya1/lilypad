<script setup lang="ts">
import FileExplorer from './FileExplorer.vue'
import ImagesTab from './ImagesTab.vue'
import SearchPanel from './SearchPanel.vue'
import LilypadIcon from '@/assets/icon.svg'
import { LogOut, Loader2, Settings, Search } from 'lucide-vue-next'
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useSearchStore } from '@/stores/search'
import { useUiStore } from '@/stores/ui'
import { useRouter } from 'vue-router'
import SettingsModal from '@/components/settings/SettingsModal.vue'

const auth = useAuthStore()
const editorStore = useEditorStore()
const filesStore = useFilesStore()
const searchStore = useSearchStore()
const uiStore = useUiStore()
const router = useRouter()

const isSyncing = computed(() => editorStore.savingIds.size > 0)
const showSettings = ref(false)

async function signOut() {
  editorStore.$reset()
  filesStore.$reset()
  await auth.signOut()
  router.replace({ name: 'login' })
}

const sidebarWidth = ref(250)
const snapThreshold = 160
const maxWidth = 500
const minimizedWidth = 64

const isMinimized = ref(false)
const isResizing = ref(false)

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

const startResize = () => {
  isResizing.value = true
  document.body.classList.add('select-none')
  document.addEventListener('mousemove', resize)
  document.addEventListener('mouseup', stopResize)
}

const resize = (event: MouseEvent) => {
  if (!isResizing.value) return

  const newWidth = event.clientX

  if (newWidth < snapThreshold) {
    isMinimized.value = true
  } else if (newWidth <= maxWidth) {
    isMinimized.value = false
    sidebarWidth.value = newWidth
  }
}

const stopResize = () => {
  isResizing.value = false
  document.body.classList.remove('select-none')
  document.removeEventListener('mousemove', resize)
  document.removeEventListener('mouseup', stopResize)
}

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
  document.removeEventListener('mousemove', resize)
  document.removeEventListener('mouseup', stopResize)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div
    class="relative flex flex-col h-screen bg-surface border-r border-border-subtle shrink-0"
    :class="{ 'transition-[width] duration-200 ease-in-out': !isResizing }"
    :style="{ width: (isMinimized ? minimizedWidth : sidebarWidth) + 'px' }"
  >
    <div class="flex flex-row items-center p-4">
      <LilypadIcon class="w-8 h-8 shrink-0" :class="{ 'mr-2': !isMinimized }" />
      <h1
        v-if="!isMinimized"
        class="font-display font-medium text-xl text-text-primary leading-none flex-1"
      >
        Lilypad
      </h1>
      <button
        v-if="!isMinimized"
        class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
        title="Search (Ctrl+Shift+F)"
        @click="searchStore.toggle()"
      >
        <Search :size="15" />
      </button>
      <Loader2
        v-if="!isMinimized && isSyncing"
        :size="15"
        class="animate-spin text-text-muted shrink-0"
        title="Saving…"
      />
    </div>
    <div class="border-t border-border-subtle" />

    <div v-if="!isMinimized" class="relative flex-1 flex flex-col overflow-hidden">
      <SearchPanel v-if="searchStore.isOpen" />
      <template v-else>
        <div class="flex border-b border-border-subtle shrink-0">
          <button
            v-for="tab in (['files', 'images'] as const)"
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
    </div>

    <div
      v-if="!isMinimized && auth.user"
      class="border-t border-border-subtle px-3 py-2 flex items-center gap-2"
    >
      <span class="flex-1 text-xs text-text-secondary truncate">
        {{ auth.user.email }}
      </span>
      <button
        class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
        title="Settings"
        @click="showSettings = true"
      >
        <Settings :size="15" />
      </button>
      <button
        class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
        title="Sign out"
        @click="signOut"
      >
        <LogOut :size="15" />
      </button>
    </div>

    <SettingsModal :show="showSettings" @close="showSettings = false" />

    <div
      class="group absolute top-0 right-0 h-full w-4 cursor-col-resize -mr-2"
      @mousedown="startResize"
    >
      <div
        class="absolute top-0 left-1/2 -translate-x-1/2 h-full transition-all duration-100"
        :class="
          isResizing
            ? 'bg-accent w-0.75'
            : 'bg-transparent w-0.5 group-hover:bg-border group-hover:w-0.75'
        "
      ></div>
    </div>
  </div>
</template>
