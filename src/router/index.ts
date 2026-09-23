// Vue Router config: login + desktop app shell + mobile reader, with an auth guard that defers
// while loading and a small-viewport redirect from the desktop app to the reader.
import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '@/components/auth/LoginPage.vue'
import AppShell from '@/components/AppShell.vue'
import ReaderShell from '@/components/reader/ReaderShell.vue'
import ReaderBrowser from '@/components/reader/ReaderBrowser.vue'
import ReaderDocument from '@/components/reader/ReaderDocument.vue'
import ReaderSearch from '@/components/reader/ReaderSearch.vue'
import { useAuthStore } from '@/stores/auth'
import { isSmallViewport } from '@/lib/viewport'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginPage,
    },
    {
      path: '/',
      name: 'app',
      component: AppShell,
    },
    {
      path: '/read',
      component: ReaderShell,
      children: [
        { path: '', name: 'reader-browser', component: ReaderBrowser },
        // Must precede ':entryId' so "search" isn't captured as an entry id.
        { path: 'search', name: 'reader-search', component: ReaderSearch },
        { path: ':entryId', name: 'reader-document', component: ReaderDocument, props: true },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  // While the Supabase session is still resolving (on first load), let the navigation proceed
  // and trust that main.ts will redirect after initialize() resolves.
  if (auth.loading) return true

  if (!auth.session && to.name !== 'login') {
    return { name: 'login' }
  }

  // Redirect already-authed users away from the login page.
  if (auth.session && to.name === 'login') {
    return { name: 'app' }
  }

  // Small viewports get the mobile reader instead of the desktop app. `?desktop=1` opts out.
  // This is the entire "mobile detection" — no user-agent sniffing; /read stays reachable by URL.
  if (to.name === 'app' && isSmallViewport() && to.query.desktop !== '1') {
    return { name: 'reader-browser' }
  }
})

export default router
