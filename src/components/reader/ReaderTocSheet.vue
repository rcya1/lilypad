<!-- Bottom sheet listing the current note's headings. Tap an entry to scroll to it; the parent
     closes the sheet. No gesture library — a plain slide-up transition + scrim tap-to-close. -->
<script setup lang="ts">
import type { TocItem } from '@/lib/markdown'

defineProps<{ toc: TocItem[]; open: boolean }>()
const emit = defineEmits<{ select: [id: string]; close: [] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-50 bg-black/30" @click="emit('close')" />
    </Transition>
    <Transition name="slide-up">
      <div
        v-if="open"
        class="fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <!-- Drag handle (visual only) -->
        <div class="sticky top-0 flex flex-col items-center bg-surface pt-2 pb-1">
          <div class="h-1 w-10 rounded-full bg-border" />
          <span class="mt-2 text-xs font-medium uppercase tracking-widest text-text-muted">
            On this page
          </span>
        </div>
        <nav class="px-2 pb-2">
          <button
            v-for="item in toc"
            :key="item.id"
            class="flex min-h-11 w-full cursor-pointer items-center rounded-lg px-2 text-left text-sm transition-colors hover:bg-surface-elevated active:bg-surface-overlay"
            :class="item.depth === 1 ? 'font-medium text-text-primary' : 'text-text-secondary'"
            :style="{ paddingLeft: (item.depth - 1) * 16 + 8 + 'px' }"
            @click="emit('select', item.id)"
          >
            <span class="truncate">{{ item.text }}</span>
          </button>
        </nav>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
