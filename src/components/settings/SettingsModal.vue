<!-- Settings panel (Escape to close): appearance toggles and Vim configuration. -->
<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import VimSettings from './VimSettings.vue'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()
const uiStore = useUiStore()

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

// Only register the Escape listener while the modal is open — avoids conflicting with other
// Escape handlers (e.g. Vim insert mode) when the modal is closed.
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
                <X :size="15" />
              </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
              <!-- Appearance -->
              <section>
                <p
                  class="text-xs font-medium text-text-muted uppercase tracking-widest mb-4 font-ui"
                >
                  Appearance
                </p>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-text-secondary font-ui">Dark mode</span>
                  <button
                    role="switch"
                    :aria-checked="uiStore.isDarkMode"
                    class="relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer shrink-0"
                    :class="uiStore.isDarkMode ? 'bg-accent' : 'bg-surface-overlay'"
                    @click="uiStore.toggleDarkMode()"
                  >
                    <span
                      class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150"
                      :class="uiStore.isDarkMode ? 'translate-x-4' : 'translate-x-0'"
                    />
                  </button>
                </div>
              </section>

              <div class="border-t border-border-subtle" />

              <!-- Vim -->
              <section>
                <p
                  class="text-xs font-medium text-text-muted uppercase tracking-widest mb-4 font-ui"
                >
                  Vim
                </p>
                <VimSettings />
              </section>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
