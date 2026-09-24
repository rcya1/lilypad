<!-- Draggable right edge shared by the editor and reader sidebars. Drag to resize (writes the shared
     width in the ui store); drag below the snap threshold to minimize to the icon rail. While a drag
     is active `uiStore.sidebarResizing` is true so the sidebar can drop its width transition and
     track the cursor exactly. Place inside a `relative` sidebar root. -->
<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()
const { sidebarWidth, sidebarMinimized, sidebarResizing } = storeToRefs(uiStore)

// Dragging below this pixel offset snaps the sidebar to minimized mode instead of making it tiny.
const SNAP_THRESHOLD = 160
const MAX_WIDTH = 500

/**
 * Begins a drag-resize session.
 * Attaches document-level listeners instead of the element's own events so the
 * cursor can move freely outside the handle without dropping the resize.
 */
function startResize() {
  sidebarResizing.value = true
  // Prevent text selection while dragging across the document.
  document.body.classList.add('select-none')
  document.addEventListener('mousemove', resize)
  document.addEventListener('mouseup', stopResize)
}

/**
 * Handles mousemove during a resize drag.
 * clientX maps directly to sidebar width because the sidebar is flush with the
 * left edge of the viewport. Values below SNAP_THRESHOLD collapse to minimized
 * rather than producing a tiny visible panel.
 */
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

/**
 * Ends the drag-resize session and cleans up document-level listeners.
 * Must mirror every listener added in startResize to avoid leaks.
 */
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
