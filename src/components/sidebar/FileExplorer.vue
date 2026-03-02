<script setup lang="ts">
import FileExplorerNode from './FileExplorerNode.vue'
import type { Entry } from '@/types/file-explorer'
import { ref } from 'vue'
const content = ref<Entry[]>([
  {
    kind: 'document',
    name: 'welcome.md',
    type: 'md',
  },
  {
    kind: 'document',
    name: 'notes.md',
    type: 'md',
  },
  {
    kind: 'directory',
    name: 'subfolder',
    children: [
      {
        kind: 'document',
        name: 'math.md',
        type: 'md',
      },
    ],
  },
])
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="px-3 pt-1 pb-2">
      <span class="text-xs font-medium text-text-muted uppercase tracking-widest">Files</span>
    </div>
    <div class="text-sm select-none">
      <FileExplorerNode
        v-for="entry in content"
        :key="entry.name"
        :entry="entry"
        :depth="0"
        path-prefix=""
      />
    </div>
  </div>
</template>
