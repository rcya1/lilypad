// Pinia store for toast notifications.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'error' | 'success' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

// Exported so ToastContainer's exit animation matches.
export const TOAST_DURATION_MS = 5000

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])

  /** `type` defaults to 'error', since most toasts report failures. */
  function addToast(message: string, type: ToastType = 'error') {
    const id = Math.random().toString(36).slice(2)
    toasts.value.push({ id, message, type })
    setTimeout(() => removeToast(id), TOAST_DURATION_MS)
  }

  /** Safe if it's already gone (dismissed before the timer fired). */
  function removeToast(id: string) {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  return { toasts, addToast, removeToast }
})
