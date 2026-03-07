<script setup lang="ts">
import FileExplorer from './FileExplorer.vue'
import LilypadIcon from '@/assets/icon-light.svg'
import { LogOut } from 'lucide-vue-next'
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()

const sidebarWidth = ref(250)
const snapThreshold = 160
const maxWidth = 500
const minimizedWidth = 64

const isMinimized = ref(false)
const isResizing = ref(false)

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
        class="font-display font-medium text-xl text-text-primary leading-none"
      >
        Lilypad
      </h1>
    </div>
    <div class="border-t border-border-subtle" />

    <FileExplorer v-if="!isMinimized" />

    <!-- User info + logout -->
    <div
      v-if="!isMinimized && auth.user"
      class="mt-auto border-t border-border-subtle px-3 py-2 flex items-center gap-2"
    >
      <span class="flex-1 text-xs text-text-secondary truncate">
        {{ auth.user.email }}
      </span>
      <button
        class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
        title="Sign out"
        @click="
          async () => {
            useEditorStore().$reset()
            useFilesStore().$reset()
            await auth.signOut()
            router.replace({ name: 'login' })
          }
        "
      >
        <LogOut :size="14" />
      </button>
    </div>

    <!-- Resize handle -->
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
