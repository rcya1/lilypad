<script setup lang="ts">
import { ref } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, File } from 'lucide-vue-next'

const props = defineProps<{
  entry: Entry
  depth: number
}>()

const isOpen = ref(true)

const toggle = () => {
  if (isDirectory(props.entry)) {
    isOpen.value = !isOpen.value
  }
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm text-text-secondary hover:bg-surface-elevated hover:text-text-primary transition-colors duration-100"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="toggle"
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
          <FileText :size="15" class="text-accent" />
        </template>
      </span>

      <!-- Name -->
      <span class="truncate">
        {{ entry.name }}
      </span>
    </div>

    <div v-if="isDirectory(entry) && isOpen">
      <FileExplorerNode
        v-for="child in entry.children"
        :key="child.name"
        :entry="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
