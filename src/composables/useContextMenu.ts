// Composable for right-click context menus: tracks position and visibility, auto-closes on outside click.
import { ref, onBeforeUnmount } from 'vue'

/**
 * Right-click context-menu state: tracks visibility and screen position, and
 * auto-closes on the next outside click. The click listener is registered only
 * while the menu is open and is always cleaned up (on close and on unmount).
 */
export function useContextMenu() {
  const visible = ref(false)
  const position = ref({ x: 0, y: 0 })

  function close() {
    if (!visible.value) return
    visible.value = false
    window.removeEventListener('click', close)
  }

  function open(e: MouseEvent) {
    e.preventDefault()
    position.value = { x: e.clientX, y: e.clientY }
    visible.value = true
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => window.addEventListener('click', close), 0)
  }

  onBeforeUnmount(() => window.removeEventListener('click', close))

  return { visible, position, open, close }
}
