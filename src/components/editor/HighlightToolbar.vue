<!-- Floating toolbar over a text selection in a web page or PDF: one swatch per highlight colour,
     plus "highlight and add a note". The parent positions it (x = centre, y = top of selection). -->
<script setup lang="ts">
import { StickyNote } from 'lucide-vue-next'
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_KEYS } from '@/stores/annotations'
import type { HighlightColor } from '@/types/database'

defineProps<{ x: number; y: number }>()
const emit = defineEmits<{ highlight: [color: HighlightColor]; annotate: [] }>()
</script>

<template>
  <div
    class="overlay-pop absolute z-30 flex items-center gap-1 px-1.5 py-1 rounded-lg bg-surface border border-border shadow-lg -translate-x-1/2 -translate-y-full"
    :style="{ left: x + 'px', top: y - 8 + 'px' }"
  >
    <button
      v-for="key in HIGHLIGHT_COLOR_KEYS"
      :key="key"
      class="w-5 h-5 rounded-full border border-black/10 cursor-pointer transition-transform hover:scale-110"
      :style="{ backgroundColor: HIGHLIGHT_COLORS[key].swatch }"
      :title="`Highlight ${key}`"
      @click="emit('highlight', key)"
    />
    <div class="w-px h-4 bg-border mx-0.5" />
    <button
      class="flex items-center justify-center w-6 h-6 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated cursor-pointer"
      title="Highlight and add a note"
      @click="emit('annotate')"
    >
      <StickyNote :size="14" />
    </button>
  </div>
</template>

<style scoped>
/* Fade only: positioned with translate utilities, which a transform animation would fight. */
.overlay-pop {
  animation: overlay-in 120ms ease-out;
}
@keyframes overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
