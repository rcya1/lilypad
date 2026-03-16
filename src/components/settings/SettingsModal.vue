<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import VimSettings from './VimSettings.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.show,
  (val) => {
    if (val) {
      window.addEventListener('keydown', onKeyDown)
    } else {
      window.removeEventListener('keydown', onKeyDown)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 ease-out"
      leave-active-class="transition-opacity duration-100 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="show"
        class="fixed inset-0 z-[600] flex items-center justify-center bg-black/20"
        @click.self="emit('close')"
      >
        <Transition
          enter-active-class="transition duration-150 ease-out"
          leave-active-class="transition duration-100 ease-in"
          enter-from-class="opacity-0 scale-95 -translate-y-1"
          leave-to-class="opacity-0 scale-95 -translate-y-1"
          appear
        >
          <div
            v-if="show"
            class="bg-bg border border-border rounded-xl shadow-xl w-[480px] max-h-[80vh] flex flex-col"
          >
            <!-- Header -->
            <div
              class="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle shrink-0"
            >
              <h2 class="text-sm font-medium text-text-primary font-ui">Settings</h2>
              <button
                class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
                @click="emit('close')"
              >
                <X :size="14" />
              </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto px-5 py-4">
              <p
                class="text-xs font-medium text-text-muted uppercase tracking-widest mb-4 font-ui"
              >
                Vim
              </p>
              <VimSettings />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
