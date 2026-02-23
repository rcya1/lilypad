<script setup lang="ts">
import FileExplorer from './FileExplorer.vue'
import LilypadIcon from '@/assets/icon-light.svg'
import { ref, onBeforeUnmount } from 'vue'

const sidebarWidth = ref(250)
const widthBeforeSnapping = 160
const maxWidth = 500

let isResizing = false

const startResize = () => {
  isResizing = true
  document.body.classList.add('select-none')
  document.addEventListener('mousemove', resize)
  document.addEventListener('mouseup', stopResize)
}

const resize = (event: MouseEvent) => {
  if (!isResizing) return

  const newWidth = event.clientX

  if (newWidth >= widthBeforeSnapping && newWidth <= maxWidth) {
    sidebarWidth.value = newWidth
  }
}

const stopResize = () => {
  isResizing = false
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
    class="relative flex flex-col p-4 h-screen bg-gray-100"
    :style="{ width: sidebarWidth + 'px' }"
  >
    <div class="flex flex-row mb-6">
      <LilypadIcon class="w-8 h-8 mr-2" />
      <h1 class="text-xl">Lilypad</h1>
    </div>

    <FileExplorer />

    <div
      class="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-white/20 transition-colors"
      @mousedown="startResize"
    ></div>
  </div>
</template>
