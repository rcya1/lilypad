<!-- Bottom of both sidebars (editor and reader): the signed-in email, settings and sign out. Shared
     so the two modes line up exactly. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Settings } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useWebAnnotationsStore } from '@/stores/webAnnotations'
import SettingsModal from '@/components/settings/SettingsModal.vue'

const auth = useAuthStore()
const editorStore = useEditorStore()
const filesStore = useFilesStore()
const webAnnotationsStore = useWebAnnotationsStore()
const router = useRouter()

const showSettings = ref(false)

/**
 * Signs the user out and returns to the login screen.
 * Resets editor and file stores first so stale state doesn't leak into
 * the next login session if the app is not fully reloaded.
 */
async function signOut() {
  editorStore.$reset()
  filesStore.$reset()
  webAnnotationsStore.$reset()
  await auth.signOut()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div v-if="auth.user" class="border-t border-border-subtle px-3 py-2 flex items-center gap-2">
    <span class="flex-1 text-xs text-text-secondary truncate">
      {{ auth.user.email }}
    </span>
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
