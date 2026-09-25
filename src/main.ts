// App entry point: mounts Vue with Pinia + Router, then bootstraps auth before navigating.
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './index.css'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
// Autofocus for inputs that appear conditionally (rename fields, modals).
app.directive('focus', { mounted: (el: HTMLElement) => el.focus() })

const pinia = createPinia()

app.use(pinia)
app.use(router)

const auth = useAuthStore()
// Initialize auth before the first route renders so the navigation guard in router/index.ts
// has a resolved session to check. Without this, the guard sees auth.loading=true and lets
// every navigation through, only to redirect after the async check completes.
auth.initialize().then(() => {
  if (!auth.user) {
    router.replace({ name: 'login' })
  }
})

app.mount('#app')
