<script setup lang="ts">
import FileExplorerNode from './FileExplorerNode.vue'
import type { Entry } from '@/types/file-explorer'
import { ref } from 'vue'
const content = ref<Entry[]>([
  {
    kind: 'document',
    name: 'file1.txt',
    type: 'txt',
  },
  {
    kind: 'document',
    name: 'file2.txt',
    type: 'txt',
  },
  {
    kind: 'directory',
    name: 'subfolder',
    children: [
      {
        kind: 'document',
        name: 'file3.pdf',
        type: 'pdf',
      },
    ],
  },
])
</script>

<template>
  <div class="text-sm select-none">
    <FileExplorerNode v-for="entry in content" :key="entry.name" :entry="entry" :depth="0" />
  </div>
</template>
