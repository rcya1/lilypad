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

  if (auth.loading) return true

  if (!auth.session && to.name !== 'login') {
    return { name: 'login' }
  }

  if (auth.session && to.name === 'login') {
    return { name: 'app' }
  }
})

export default router
