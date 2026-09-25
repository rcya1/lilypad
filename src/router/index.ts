// Routes: login, the desktop app and the reader, with an auth guard and a small-screen redirect.
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

  // Still resolving the session on first load: main.ts redirects once it's known.
  if (auth.loading) return true

  // `user`, not `session`: offline, the app runs as the last signed-in user without a session.
  if (!auth.user && to.name !== 'login') {
    return { name: 'login' }
  }

  if (auth.user && to.name === 'login') {
    return { name: 'app' }
  }

  // Small screens get the reader; `?desktop=1` opts out. No user-agent sniffing.
  if (to.name === 'app' && isSmallViewport() && to.query.desktop !== '1') {
    return { name: 'reader-browser' }
  }
})

export default router
