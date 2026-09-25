<!-- Registers the service worker (installable app + offline shell) and, when a new version has been
     deployed, offers "Update available · Reload" instead of reloading on its own — so nothing is
     swapped out mid-edit. Styled like the toasts, but stays until acted on. -->
<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { Sparkles, X } from 'lucide-vue-next'

// Check for a new deployment hourly while the app stays open (installed apps rarely reload).
const UPDATE_CHECK_MS = 60 * 60 * 1000

const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_url, registration) {
    if (registration) setInterval(() => registration.update(), UPDATE_CHECK_MS)
  },
})

function reload() {
  void updateServiceWorker(true)
}

function dismiss() {
  needRefresh.value = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="update">
      <div
        v-if="needRefresh"
        role="status"
        class="fixed bottom-4 left-4 z-50 flex w-80 items-center gap-3 rounded-lg border border-border bg-surface py-3 pr-3 pl-4 font-ui shadow-lg"
      >
        <Sparkles :size="16" class="shrink-0 text-accent" />
        <p class="flex-1 text-sm leading-snug text-text-primary">Update available</p>
        <button
          class="cursor-pointer rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-bg transition-colors hover:bg-accent-hover"
          @click="reload"
        >
          Reload
        </button>
        <button
          class="shrink-0 cursor-pointer text-text-muted transition-colors hover:text-text-primary"
          aria-label="Dismiss"
          @click="dismiss"
        >
          <X :size="15" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-enter-active,
.update-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}
.update-enter-from,
.update-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
