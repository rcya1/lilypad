<!-- /read: a prompt to pick a note when the sidebar shows the tree, otherwise the tree itself. -->
<script setup lang="ts">
import { inject, onMounted } from 'vue'
import LilypadIcon from '@/assets/icon.svg'
import ReaderTree from './ReaderTree.vue'
import { readerKey } from './context'

const reader = inject(readerKey)

onMounted(() => {
  document.title = 'Lilypad'
})
</script>

<template>
  <div
    v-if="reader?.sidebarVisible"
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 pb-12 text-center motion-safe:animate-fade-up"
  >
    <LilypadIcon class="h-16 w-16 opacity-[0.08]" />
    <h2 class="font-display text-2xl font-normal text-text-secondary">Pick a note to read</h2>
    <p class="text-sm text-text-muted">Choose one from the sidebar</p>
  </div>
  <ReaderTree v-else class="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]" />
</template>
