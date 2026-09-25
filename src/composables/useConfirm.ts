// Awaitable confirmation dialog: `await confirm({...})` resolves true or false.
import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm button as destructive. */
  danger?: boolean
}

// Module-level: every caller and ConfirmDialog.vue share one dialog.
const open = ref(false)
const title = ref('')
const message = ref('')
const confirmLabel = ref('Confirm')
const cancelLabel = ref('Cancel')
const danger = ref(false)
let resolveFn: ((value: boolean) => void) | null = null

export function useConfirm() {
  /** Resolves false on cancel, Escape or an overlay click. */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      title.value = options.title
      message.value = options.message
      confirmLabel.value = options.confirmLabel ?? 'Confirm'
      cancelLabel.value = options.cancelLabel ?? 'Cancel'
      danger.value = options.danger ?? false
      // A newer dialog replaces this one: resolve it as cancelled so its caller doesn't hang.
      resolveFn?.(false)
      resolveFn = resolve
      open.value = true
    })
  }

  function onConfirm() {
    resolveFn?.(true)
    open.value = false
  }

  function onCancel() {
    resolveFn?.(false)
    open.value = false
  }

  return { open, title, message, confirmLabel, cancelLabel, danger, confirm, onConfirm, onCancel }
}
