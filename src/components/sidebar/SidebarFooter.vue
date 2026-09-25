<!-- Footer of both sidebars: email, sync status, settings, sign out. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Settings } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useWebAnnotationsStore } from '@/stores/webAnnotations'
import { useSyncStore } from '@/stores/sync'
import { useConfirm } from '@/composables/useConfirm'
import { wipeUser } from '@/lib/offline'
import SettingsModal from '@/components/settings/SettingsModal.vue'
import SyncStatusPill from './SyncStatusPill.vue'

const auth = useAuthStore()
const editorStore = useEditorStore()
const filesStore = useFilesStore()
const webAnnotationsStore = useWebAnnotationsStore()
const syncStore = useSyncStore()
const router = useRouter()
const { confirm } = useConfirm()

const showSettings = ref(false)

/**
 * Also wipes this user's offline copy from the device, so it syncs first and warns if anything
 * still hasn't reached the server.
 */
async function signOut() {
  editorStore.saveAll()
  await syncStore.flush()
  const unsynced = syncStore.queue.length + syncStore.conflictIds.size
  if (unsynced > 0) {
    const ok = await confirm({
      title: 'Sign out with unsynced changes?',
      message:
        unsynced === 1
          ? "1 change on this device hasn't reached the server yet. Signing out deletes it from this device."
          : `${unsynced} changes on this device haven't reached the server yet. Signing out deletes them from this device.`,
      confirmLabel: 'Sign out anyway',
      danger: true,
    })
    if (!ok) return
  }
  const userId = auth.user?.id
  editorStore.$reset()
  filesStore.$reset()
  webAnnotationsStore.$reset()
  syncStore.$reset()
  if (userId) await wipeUser(userId)
  await auth.signOut()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div v-if="auth.user" class="border-t border-border-subtle px-3 py-2 flex items-center gap-2">
    <span class="flex-1 text-xs text-text-secondary truncate">
      {{ auth.user.email }}
    </span>
    <SyncStatusPill />
    <button
      class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
      title="Settings"
      @click="showSettings = true"
    >
      <Settings :size="15" />
    </button>
    <button
      class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0"
      title="Sign out"
      @click="signOut"
    >
      <LogOut :size="15" />
    </button>
  </div>

  <SettingsModal :show="showSettings" @close="showSettings = false" />
</template>
