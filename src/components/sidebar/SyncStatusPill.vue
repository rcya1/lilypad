<!-- Sync status next to the email in the sidebar footer: "Offline · 3 pending", "Syncing",
     "3 pending", or "1 conflict" (click to open the first conflicted note). Hidden when fully
     synced. -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, CloudUpload, Loader2, WifiOff } from 'lucide-vue-next'
import { useSyncStore } from '@/stores/sync'

const sync = useSyncStore()
const router = useRouter()

const pending = computed(() => sync.queue.length)
const conflicts = computed(() => sync.conflictIds.size)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Opens the note in the editor (the editor's `?open=` handler works from the reader too).
function openFirstConflict() {
  const [id] = sync.conflictIds
  if (id) router.push({ name: 'app', query: { open: id } })
}
</script>

<template>
  <span
    v-if="sync.status === 'offline'"
    class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[11px] font-medium text-text-secondary"
    :title="
      pending
        ? 'Changes are saved on this device and will sync when you reconnect'
        : 'No connection'
    "
  >
    <WifiOff :size="11" />
    Offline<template v-if="pending"> · {{ pending }} pending</template>
  </span>
  <button
    v-else-if="sync.status === 'conflict'"
    class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-subtle px-1.5 py-0.5 text-[11px] font-medium text-amber transition-opacity hover:opacity-80"
    title="Open the first note with merge conflicts"
    @click="openFirstConflict"
  >
    <AlertTriangle :size="11" />
    {{ plural(conflicts, 'conflict') }}
  </button>
  <span
    v-else-if="sync.status === 'syncing'"
    class="inline-flex shrink-0 items-center gap-1 px-1 text-[11px] text-text-muted"
  >
    <Loader2 :size="11" class="animate-spin" />
    Syncing
  </span>
  <span
    v-else-if="sync.status === 'pending'"
    class="inline-flex shrink-0 items-center gap-1 px-1 text-[11px] text-text-muted"
    title="Waiting to sync"
  >
    <CloudUpload :size="11" />
    {{ pending }} pending
  </span>
</template>
