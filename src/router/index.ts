// Vue Router config: two routes (login + app shell) with an auth guard that defers while loading.
import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '@/components/auth/LoginPage.vue'
import AppShell from '@/components/AppShell.vue'
import { useAuthStore } from '@/stores/auth'

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
})

export default router
