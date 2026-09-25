<!-- The reader's note tree, with loading and empty states. -->
<script setup lang="ts">
import { useFilesStore } from '@/stores/files'
import ReaderTreeNode from './ReaderTreeNode.vue'
import { ensureEntriesLoaded } from './context'

const filesStore = useFilesStore()

// In setup rather than onMounted, so `loading` is true on first render (no empty-state flash).
ensureEntriesLoaded()
</script>

<template>
  <div>
    <!-- Same skeleton as the editor's file tree. -->
    <div v-if="filesStore.loading" class="space-y-2 px-3">
      <div v-for="i in 3" :key="i" class="h-6 animate-pulse rounded bg-surface-elevated" />
    </div>

    <div
      v-else-if="filesStore.tree.length === 0"
      class="flex flex-col items-center gap-2 px-6 py-12 text-center"
    >
      <h2 class="font-display text-lg text-text-secondary">No notes yet</h2>
      <p class="text-sm text-text-muted">Create notes in the editor to read them here.</p>
    </div>

    <div v-else class="text-sm select-none">
      <ReaderTreeNode v-for="entry in filesStore.tree" :key="entry.id" :entry="entry" :depth="0" />
    </div>
  </div>
</template>
