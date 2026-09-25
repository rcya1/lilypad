// Pinia store for the Supabase session and OAuth sign-in/out.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { rememberUser, recallUser, forgetUser } from '@/lib/offline'
import { useUiStore } from './ui'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  // Until the first getSession() resolves; the app waits on this before rendering.
  const loading = ref(true)
  // Running offline as the last signed-in user because the session can't be refreshed. Clears once
  // Supabase refreshes it back online.
  const offlineUser = ref(false)

  function setSession(next: Session | null) {
    session.value = next
    user.value = next?.user ?? null
    offlineUser.value = false
    if (next?.user) rememberUser({ id: next.user.id, email: next.user.email ?? null })
  }

  /**
   * Call once at startup (main.ts). Restores the session and listens for later changes; loads cloud
   * settings when signed in.
   */
  async function initialize() {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession()
    setSession(currentSession)

    // Offline with a session that needs refreshing: carry on as the last signed-in user.
    if (!currentSession && !navigator.onLine) {
      const cached = recallUser()
      if (cached) {
        user.value = { id: cached.id, email: cached.email ?? undefined } as User
        offlineUser.value = true
      }
    }
    loading.value = false

    if (currentSession?.user) {
      useUiStore().loadSettings(currentSession.user.id)
    }

    supabase.auth.onAuthStateChange((event, newSession) => {
      // While running offline on the cached user, ignore "no session" notices until a real
      // sign-out (or a refreshed session) arrives.
      if (!newSession && offlineUser.value && event !== 'SIGNED_OUT') return
      setSession(newSession)
      // Hydrate settings only on a genuine sign-in. TOKEN_REFRESHED fires ~hourly and
      // re-hydrating then can revert a setting changed within the save-debounce window.
      if (event === 'SIGNED_IN' && newSession?.user) {
        useUiStore().loadSettings(newSession.user.id)
      }
    })
  }

  /** Redirects back to this origin; the auth listener picks up the session. */
  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInWithGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
    forgetUser()
    setSession(null)
  }

  return {
    user,
    session,
    loading,
    offlineUser,
    initialize,
    signInWithGoogle,
    signInWithGitHub,
    signOut,
  }
})
