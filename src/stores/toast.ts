// Pinia store for ephemeral toast notifications; handles add, auto-dismiss, and manual removal.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'error' | 'success' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

// How long a toast stays visible before auto-dismissal. Exported so ToastContainer
// can drive an identical CSS exit animation duration.
export const TOAST_DURATION_MS = 5000

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])

  /**
   * Adds a toast and schedules its automatic removal after TOAST_DURATION_MS.
   *
   * @param message - Human-readable message to display.
   * @param type    - Visual severity; defaults to 'error' since most callers surface failures.
   */
  function addToast(message: string, type: ToastType = 'error') {
    // Random base-36 suffix is short and collision-resistant enough for a UI list.
    const id = Math.random().toString(36).slice(2)
    toasts.value.push({ id, message, type })
    setTimeout(() => removeToast(id), TOAST_DURATION_MS)
  }

  /**
   * Removes a toast by ID. Safe to call even if the toast was already removed
   * (e.g. user dismissed it before the auto-remove timer fired).
   */
  function removeToast(id: string) {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  return { toasts, addToast, removeToast }
})
