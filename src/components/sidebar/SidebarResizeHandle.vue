<!-- The draggable right edge of both sidebars: drag to resize, or past the snap point to minimize.
     Sets `sidebarResizing` so the sidebar can drop its width transition while dragging. Needs a
     `relative` parent. -->
<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()
const { sidebarWidth, sidebarMinimized, sidebarResizing } = storeToRefs(uiStore)

// Dragging below this pixel offset snaps the sidebar to minimized mode instead of making it tiny.
const SNAP_THRESHOLD = 160
const MAX_WIDTH = 500

/** Document listeners, so the drag survives the cursor leaving the handle. */
function startResize() {
  sidebarResizing.value = true
  document.body.classList.add('select-none')
  document.addEventListener('mousemove', resize)
  document.addEventListener('mouseup', stopResize)
}

/** The sidebar is flush with the left edge, so clientX is the width. */
function resize(event: MouseEvent) {
  if (!sidebarResizing.value) return
  const newWidth = event.clientX
  if (newWidth < SNAP_THRESHOLD) {
    sidebarMinimized.value = true
  } else if (newWidth <= MAX_WIDTH) {
    sidebarMinimized.value = false
    sidebarWidth.value = newWidth
  }
}

function stopResize() {
  sidebarResizing.value = false
  document.body.classList.remove('select-none')
  document.removeEventListener('mousemove', resize)
  document.removeEventListener('mouseup', stopResize)
}

onBeforeUnmount(stopResize)
</script>

<template>
  <div
    class="group absolute top-0 right-0 h-full w-4 cursor-col-resize -mr-2"
    @mousedown="startResize"
  >
    <div
      class="absolute top-0 left-1/2 -translate-x-1/2 h-full transition-all duration-100"
      :class="
        sidebarResizing
          ? 'bg-accent w-0.75'
          : 'bg-transparent w-0.5 group-hover:bg-border group-hover:w-0.75'
      "
    ></div>
  </div>
</template>
