<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, File } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{
  entry: Entry
  depth: number
  pathPrefix: string
}>()

const store = useEditorStore()
const isOpen = ref(true)

// Full path used as a stable document ID
const fullPath = computed(() =>
  props.pathPrefix ? `${props.pathPrefix}/${props.entry.name}` : props.entry.name,
)

// Path prefix passed to direct children (only relevant for directories)
const childPathPrefix = computed(() => fullPath.value)

function handleClick() {
  if (isDirectory(props.entry)) {
    isOpen.value = !isOpen.value
  } else if (props.entry.type === 'md') {
    store.openDocument(fullPath.value, props.entry.name, props.entry.type)
  }
}

const isActive = computed(
  () => !isDirectory(props.entry) && store.activeDocumentId === fullPath.value,
)
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm transition-colors duration-100"
      :class="
        isActive
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
      "
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="handleClick"
    >
      <!-- Chevron -->
      <span class="w-3 flex items-center justify-center text-text-muted shrink-0">
        <template v-if="isDirectory(entry)">
          <ChevronDown v-if="isOpen" :size="12" />
          <ChevronRight v-else :size="12" />
        </template>
      </span>

      <!-- Icon -->
      <span class="flex items-center shrink-0">
        <template v-if="isDirectory(entry)">
          <FolderOpen v-if="isOpen" :size="15" class="text-amber" />
          <Folder v-else :size="15" class="text-amber" />
        </template>
        <template v-else-if="!isDirectory(entry) && entry.type === 'pdf'">
          <File :size="15" class="text-amber" />
        </template>
        <template v-else>
          <FileText :size="15" :class="isActive ? 'text-accent' : 'text-text-secondary'" />
        </template>
      </span>

      <!-- Name -->
      <span class="truncate">
        {{ entry.name }}
      </span>
    </div>

    <div
      v-if="isDirectory(entry)"
      class="grid transition-[grid-template-rows] duration-150 ease-in-out"
      :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }"
    >
      <div class="overflow-hidden min-h-0">
        <FileExplorerNode
          v-for="child in entry.children"
          :key="child.name"
          :entry="child"
          :depth="depth + 1"
          :path-prefix="childPathPrefix"
        />
      </div>
    </div>
  </div>
</template>
