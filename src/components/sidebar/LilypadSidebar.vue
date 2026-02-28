<script setup lang="ts">
import FileExplorer from './FileExplorer.vue'
import LilypadIcon from '@/assets/icon-light.svg'
import { ref, onBeforeUnmount } from 'vue'

const sidebarWidth = ref(250)
const snapThreshold = 160
const maxWidth = 500
const minimizedWidth = 48

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

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', resize)
  document.removeEventListener('mouseup', stopResize)
})
</script>

<template>
  <div
    class="relative flex flex-col h-screen bg-gray-100 shrink-0"
    :style="{ width: (isMinimized ? minimizedWidth : sidebarWidth) + 'px' }"
  >
    <div class="flex flex-row p-4 mb-2">
      <LilypadIcon class="w-8 h-8 shrink-0" :class="{ 'mr-2': !isMinimized }" />
      <h1 v-if="!isMinimized" class="text-xl">Lilypad</h1>
    </div>

    <FileExplorer v-if="!isMinimized" />

    <!-- Resize handle -->
    <div
      class="group absolute top-0 right-0 h-full w-4 cursor-col-resize -mr-2"
      @mousedown="startResize"
    >
      <div
        class="absolute top-0 left-1/2 -translate-x-1/2 h-full transition-all duration-100"
        :class="
          isResizing
            ? 'bg-indigo-400 w-0.75'
            : 'bg-transparent w-0.5 group-hover:bg-indigo-400 group-hover:w-0.75'
        "
      ></div>
    </div>
  </div>
</template>
