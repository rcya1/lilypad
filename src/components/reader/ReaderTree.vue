<!-- The reader's note tree with its loading and empty states. Shown in the reader sidebar (docked on
     wide screens, a drawer on narrow ones) and as the /read home on narrow screens. -->
<script setup lang="ts">
import { useFilesStore } from '@/stores/files'
import ReaderTreeNode from './ReaderTreeNode.vue'
import { ensureEntriesLoaded } from './context'

const filesStore = useFilesStore()

// Kick off the fetch during setup (not onMounted) so `loading` is already true on first render —
// otherwise the empty state flashes for a frame. No-op if the entries are already loaded.
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
