<!-- Modal for confirming destructive actions; driven by the useConfirm singleton so any caller can await a boolean result. -->
<script setup lang="ts">
import { useConfirm } from '@/composables/useConfirm'

const { open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel } =
  useConfirm()

// mousedown (not click) on the overlay so the cancel fires before any drag-release click propagates.
function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) onCancel()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onCancel()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        style="background: rgba(30, 42, 30, 0.4); backdrop-filter: blur(2px)"
        @mousedown="onOverlayClick"
        @keydown="onKeydown"
      >
        <div
          class="relative w-full max-w-sm bg-surface border border-border rounded-xl shadow-xl p-6 flex flex-col gap-4"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title"
        >
          <div class="flex flex-col gap-1.5">
            <h2 class="font-ui font-semibold text-text-primary text-base leading-snug">
              {{ title }}
            </h2>
            <p class="font-ui text-sm text-text-secondary leading-relaxed">{{ message }}</p>
          </div>

          <div class="flex items-center justify-end gap-2">
            <button
              class="px-3.5 py-1.5 rounded-lg text-sm font-ui font-medium text-text-secondary bg-surface-elevated hover:bg-surface-overlay transition-colors duration-100 cursor-pointer"
              @click="onCancel"
            >
              {{ cancelLabel }}
            </button>
            <button
              class="px-3.5 py-1.5 rounded-lg text-sm font-ui font-medium transition-colors duration-100 cursor-pointer"
              :class="
                danger
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-accent hover:bg-accent/90 text-white'
              "
              @click="onConfirm"
            >
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 150ms ease;
}
.dialog-enter-active > div,
.dialog-leave-active > div {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from > div,
.dialog-leave-to > div {
  opacity: 0;
  transform: scale(0.96) translateY(4px);
}
</style>
