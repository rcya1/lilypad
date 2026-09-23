<!-- The /read "home": a tappable note tree. Reuses the files store's tree + collapse state. -->
<script setup lang="ts">
import { onMounted } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import ReaderTreeNode from './ReaderTreeNode.vue'

const filesStore = useFilesStore()

onMounted(() => {
  // The desktop shell may have already loaded these in the same session; only fetch if empty.
  if (filesStore.entries.length === 0) filesStore.fetchEntries()
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
    <div v-if="filesStore.loading" class="flex justify-center py-16">
      <Loader2 :size="24" class="animate-spin text-text-muted" />
    </div>

    <div
      v-else-if="filesStore.tree.length === 0"
      class="flex flex-col items-center gap-2 px-6 py-20 text-center"
    >
      <h2 class="font-display text-xl text-text-secondary">No notes yet</h2>
      <p class="text-sm text-text-muted">Create notes in the desktop app to read them here.</p>
    </div>

    <div v-else class="py-2">
      <ReaderTreeNode v-for="entry in filesStore.tree" :key="entry.id" :entry="entry" :depth="0" />
    </div>
  </div>
</template>
