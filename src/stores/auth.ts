// Pinia store for authentication state; manages OAuth sign-in/out and the Supabase session lifecycle.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useUiStore } from './ui'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const session = ref<Session | null>(null)
  // True until the initial getSession() resolves; the app shell waits on this before rendering.
  const loading = ref(true)

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
    session.value = currentSession
    user.value = currentSession?.user ?? null
    loading.value = false

    if (currentSession?.user) {
      useUiStore().loadSettings(currentSession.user.id)
    }

    supabase.auth.onAuthStateChange((event, newSession) => {
      session.value = newSession
      user.value = newSession?.user ?? null
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
    user.value = null
    session.value = null
  }

  return { user, session, loading, initialize, signInWithGoogle, signInWithGitHub, signOut }
})
