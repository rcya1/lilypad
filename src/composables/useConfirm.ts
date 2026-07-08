// Composable for triggering a confirmation dialog and awaiting the user's boolean decision.
import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** When true, the confirm button is styled as a destructive (red) action. */
  danger?: boolean
}

// Module-level singleton: all callers — and ConfirmDialog.vue — share the same dialog instance.
// Only one dialog can be active at a time; concurrent calls cancel the previous dialog.
const open = ref(false)
const title = ref('')
const message = ref('')
const confirmLabel = ref('Confirm')
const cancelLabel = ref('Cancel')
const danger = ref(false)
let resolveFn: ((value: boolean) => void) | null = null

export function useConfirm() {
  /**
   * Opens the confirmation dialog and returns a Promise that resolves to `true` (confirmed)
   * or `false` (cancelled / dismissed via Escape or overlay click).
   *
   * Precondition: only one dialog should be in flight at a time.
   */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      title.value = options.title
      message.value = options.message
      confirmLabel.value = options.confirmLabel ?? 'Confirm'
      cancelLabel.value = options.cancelLabel ?? 'Cancel'
      danger.value = options.danger ?? false
      // A second dialog supersedes the first: resolve the old promise as "cancelled"
      // so its awaiting caller doesn't hang forever.
      resolveFn?.(false)
      resolveFn = resolve
      open.value = true
    })
  }

  /** Called by ConfirmDialog when the user clicks the confirm button. */
  function onConfirm() {
    resolveFn?.(true)
    open.value = false
  }

  /** Called by ConfirmDialog on cancel, Escape, or overlay click. */
  function onCancel() {
    resolveFn?.(false)
    open.value = false
  }

  return { open, title, message, confirmLabel, cancelLabel, danger, confirm, onConfirm, onCancel }
}
