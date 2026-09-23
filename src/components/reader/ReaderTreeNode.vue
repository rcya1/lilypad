<!-- One row in the reader's note tree; recurses for folder children. Deliberately minimal (no
     drag-drop, multi-select, or context menu) — tap a folder to expand/collapse, tap a note to open
     it. Not to be confused with the desktop FileExplorerNode. -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { isDirectory, type Entry } from '@/types/file-explorer'
import { Folder, FolderOpen, FileText, Image, Globe, File, ChevronRight } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'

// Explicit name so the template can reference itself recursively regardless of build heuristics.
defineOptions({ name: 'ReaderTreeNode' })

const props = defineProps<{ entry: Entry; depth: number }>()
const filesStore = useFilesStore()
const router = useRouter()

const isOpen = computed(() => !filesStore.isFolderCollapsed(props.entry.id))
const children = computed(() => (isDirectory(props.entry) ? props.entry.children : []))

// pdf/web notes render only as a "view on desktop" placeholder, so dim them in the tree.
const dimmed = computed(
  () => !isDirectory(props.entry) && (props.entry.type === 'pdf' || props.entry.type === 'web'),
)

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
  return props.entry.type === 'md' || props.entry.type === 'web'
    ? 'text-text-secondary'
    : 'text-amber'
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
    class="flex min-h-11 w-full items-center gap-2 pr-3 text-left transition-colors active:bg-surface-elevated"
    :class="dimmed ? 'opacity-50' : ''"
    :style="{ paddingLeft: depth * 16 + 12 + 'px' }"
    @click="onTap"
  >
    <ChevronRight
      v-if="isDirectory(entry)"
      :size="16"
      class="shrink-0 text-text-muted transition-transform duration-100"
      :class="isOpen ? 'rotate-90' : ''"
    />
    <span v-else class="w-4 shrink-0" />
    <component :is="icon" :size="18" class="shrink-0" :class="iconClass" />
    <span
      class="truncate text-sm"
      :class="isDirectory(entry) ? 'font-medium text-text-primary' : 'text-text-secondary'"
    >
      {{ label }}
    </span>
  </button>

  <template v-if="isDirectory(entry) && isOpen">
    <ReaderTreeNode v-for="child in children" :key="child.id" :entry="child" :depth="depth + 1" />
  </template>
</template>
