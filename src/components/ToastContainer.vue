<!-- Bottom-right toast stack; the progress bar matches the store's auto-dismiss time. -->
<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="t in toast.toasts"
          :key="t.id"
          class="relative pointer-events-auto flex items-start gap-3 pl-4 pr-3 py-3 rounded-lg shadow-lg border bg-surface w-80 overflow-hidden"
          :class="{
            'border-red-300': t.type === 'error',
            'border-border': t.type !== 'error',
          }"
        >
          <AlertCircle v-if="t.type === 'error'" :size="16" class="text-red-500 shrink-0 mt-px" />
          <CheckCircle2
            v-else-if="t.type === 'success'"
            :size="16"
            class="text-accent shrink-0 mt-px"
          />
          <Info v-else :size="16" class="text-text-muted shrink-0 mt-px" />

          <p class="flex-1 text-sm text-text-primary font-ui leading-snug">{{ t.message }}</p>

          <button
            class="shrink-0 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            @click="toast.removeToast(t.id)"
          >
            <X :size="15" />
          </button>

          <div
            class="absolute bottom-0 left-0 h-0.5 toast-progress"
            :class="{
              'bg-red-400': t.type === 'error',
              'bg-accent': t.type === 'success',
              'bg-text-muted': t.type === 'info',
            }"
          />
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.2s ease-out;
}
.toast-leave-active {
  transition: all 0.25s ease-in;
}
.toast-move {
  transition: transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(0.75rem);
}

.toast-progress {
  width: 100%;
  animation: toast-shrink 5s linear forwards;
}

@keyframes toast-shrink {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}
</style>
