<!-- One row in the reader's note tree; recurses for folder children. Deliberately minimal (no
     drag-drop, multi-select, or context menu) — tap a folder to expand/collapse, tap a note to open
     it. Not to be confused with the desktop FileExplorerNode, but drawn to its exact row metrics
     (padding, indent, guides, icons) so the tree doesn't shift when flipping Read/Edit. -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isDirectory, type Entry } from '@/types/file-explorer'
import { Folder, FolderOpen, FileText, Image, Globe, File } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'

// Explicit name so the template can reference itself recursively regardless of build heuristics.
defineOptions({ name: 'ReaderTreeNode' })

const props = defineProps<{ entry: Entry; depth: number }>()
const filesStore = useFilesStore()
const route = useRoute()
const router = useRouter()

// The note currently open in the reader gets the selected-row highlight.
const isCurrent = computed(() => route.params.entryId === props.entry.id)

const isOpen = computed(() => !filesStore.isFolderCollapsed(props.entry.id))
const children = computed(() => (isDirectory(props.entry) ? props.entry.children : []))

// PDFs render only as a "view on desktop" placeholder, so dim them in the tree.
const dimmed = computed(() => !isDirectory(props.entry) && props.entry.type === 'pdf')

const icon = computed(() => {
  if (isDirectory(props.entry)) return isOpen.value ? FolderOpen : Folder
  switch (props.entry.type) {
    case 'image':
      return Image
    case 'web':
      return Globe
    case 'pdf':
      return File
    default:
      return FileText
  }
})

const iconClass = computed(() => {
  if (isDirectory(props.entry)) return 'text-amber'
  if (props.entry.type === 'md' || props.entry.type === 'web') {
    return isCurrent.value ? 'text-accent' : 'text-text-secondary'
  }
  return 'text-amber'
})

// Folders + web docs keep their full name; other documents drop the file extension.
const label = computed(() => {
  if (isDirectory(props.entry) || props.entry.type === 'web') return props.entry.name
  return props.entry.name.replace(/\.[^.]+$/, '')
})

function onTap() {
  if (isDirectory(props.entry)) {
    if (isOpen.value) filesStore.collapseFolder(props.entry.id)
    else filesStore.expandFolder(props.entry.id)
  } else {
    router.push({ name: 'reader-document', params: { entryId: props.entry.id } })
  }
}
</script>

<template>
  <button
    class="relative flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-left transition-colors duration-100 pointer-coarse:min-h-11"
    :class="[
      isCurrent
        ? 'bg-surface-overlay text-text-primary'
        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary active:bg-surface-overlay',
      dimmed ? 'opacity-50' : '',
    ]"
    :style="{ paddingLeft: depth * 24 + 12 + 'px' }"
    :aria-current="isCurrent ? 'page' : undefined"
    @click="onTap"
  >
    <!-- Indent guides -->
    <div
      v-for="i in depth"
      :key="'guide-' + i"
      class="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
      :style="{ left: (i - 1) * 24 + 22 + 'px' }"
    />
    <span class="flex shrink-0 items-center">
      <component :is="icon" :size="17" :class="iconClass" />
    </span>
    <span class="truncate">{{ label }}</span>
  </button>

  <!-- Animated expand/collapse (grid-rows 0fr ↔ 1fr), same as the editor tree. Children stay
       mounted so it can animate; `inert` keeps collapsed rows out of the tab order. -->
  <div
    v-if="isDirectory(entry)"
    class="grid transition-[grid-template-rows] duration-100 ease-in-out motion-reduce:transition-none"
    :class="isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    :inert="!isOpen"
  >
    <div class="min-h-0 overflow-hidden">
      <ReaderTreeNode v-for="child in children" :key="child.id" :entry="child" :depth="depth + 1" />
    </div>
  </div>
</template>
