import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

// Module-level singleton so all callers share the same dialog instance
const open = ref(false)
const title = ref('')
const message = ref('')
const confirmLabel = ref('Confirm')
const cancelLabel = ref('Cancel')
const danger = ref(false)
let resolveFn: ((value: boolean) => void) | null = null

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      title.value = options.title
      message.value = options.message
      confirmLabel.value = options.confirmLabel ?? 'Confirm'
      cancelLabel.value = options.cancelLabel ?? 'Cancel'
      danger.value = options.danger ?? false
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
