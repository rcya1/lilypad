// Pinia store for authentication state; manages OAuth sign-in/out and the Supabase session lifecycle.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { rememberUser, recallUser, forgetUser } from '@/lib/offline'
import { useUiStore } from './ui'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  // True until the initial getSession() resolves; the app shell waits on this before rendering.
  const loading = ref(true)
  // True when running offline as the last signed-in user because the session couldn't be
  // refreshed without a connection. Supabase refreshes it (and this clears) once back online.
  const offlineUser = ref(false)

  function setSession(next: Session | null) {
    session.value = next
    user.value = next?.user ?? null
    offlineUser.value = false
    if (next?.user) rememberUser({ id: next.user.id, email: next.user.email ?? null })
  }

  /**
   * Hydrates auth state from any existing Supabase session (e.g. after a page reload) and
   * registers an onAuthStateChange listener for future sign-in / sign-out events.
   *
   * Must be called exactly once at app startup (see main.ts). All subsequent auth transitions
   * (OAuth callback, sign-out, token refresh) are handled automatically by the listener.
   *
   * Side effect: triggers `ui.loadSettings` whenever a logged-in user is detected, so that
   * cloud-persisted preferences are applied before the UI is displayed.
   */
  async function initialize() {
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession()
    setSession(currentSession)

    // Offline with a session that needs refreshing: carry on as the last signed-in user so the
    // on-device copy of their notes is usable. (Only ever their own data — it's keyed by user id.)
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

  /**
   * Initiates Google OAuth flow; redirects to the current origin on completion.
   * The resulting session is picked up by the onAuthStateChange listener in initialize().
   */
  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  /**
   * Initiates GitHub OAuth flow; redirects to the current origin on completion.
   * The resulting session is picked up by the onAuthStateChange listener in initialize().
   */
  async function signInWithGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    })
  }

  /**
   * Signs out the current user from Supabase and clears local auth state.
   * The app shell reacts to `user` becoming null to redirect to the login page.
   */
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
