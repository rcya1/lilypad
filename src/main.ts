import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './index.css'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
// For inputs that appear conditionally (rename fields, modals).
app.directive('focus', { mounted: (el: HTMLElement) => el.focus() })

const pinia = createPinia()

app.use(pinia)
app.use(router)

const auth = useAuthStore()
// Before the first route renders, so the router guard has a session to check (while loading it
// lets everything through).
auth.initialize().then(() => {
  if (!auth.user) {
    router.replace({ name: 'login' })
  }
})

app.mount('#app')
