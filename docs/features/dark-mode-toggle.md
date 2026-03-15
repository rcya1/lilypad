# Feature: Dark Mode Toggle

## Overview
Add a UI control to toggle between light and dark mode. The dark mode CSS infrastructure (CSS vars under `.dark`, Tailwind `dark:` utilities) is already in place — this feature only adds the toggle mechanism and persists the preference.

## User-Facing Behavior
- A sun/moon icon button appears in the sidebar footer (bottom of the sidebar, below the file explorer).
- Clicking it switches the app between light and dark mode instantly.
- The preference is persisted in `localStorage` and restored on next app load.
- The button shows a `Sun` icon in dark mode (click to go light) and a `Moon` icon in light mode (click to go dark).

## What Needs to Change

### `src/stores/ui.ts` (extend existing — already has `previewVisible`)
- `isDarkMode` ref (boolean), initialized from `localStorage.getItem('theme') === 'dark'`.
- `toggleDarkMode()` action:
  1. Flip `isDarkMode`.
  2. Toggle the `.dark` class on `document.documentElement`.
  3. Write `localStorage.setItem('theme', isDarkMode ? 'dark' : 'light')`.
- On store initialization, apply the saved theme immediately: if `localStorage.getItem('theme') === 'dark'`, add `.dark` to `document.documentElement` before first render (to avoid a flash of light mode).

### Flash of Unstyled Content (FOUC) Prevention
- Add an inline `<script>` tag in `index.html` **before** the main bundle, in the `<head>`, that reads `localStorage.getItem('theme')` and adds `.dark` to `<html>` synchronously if needed. This prevents a light→dark flash on load for users with dark mode saved.

```html
<!-- index.html <head> -->
<script>
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark')
  }
</script>
```

### `src/components/sidebar/LilypadSidebar.vue` (or sidebar footer component)
- Add a slim footer section at the bottom of the sidebar (above or below the resize handle, below the file tree).
- Contains the dark mode toggle button: `<button @click="uiStore.toggleDarkMode()">`.
- Icon: `Moon` (16px) in light mode, `Sun` (16px) in dark mode, both in `text-text-muted hover:text-text-secondary`.

## Edge Cases
- System preference (`prefers-color-scheme: dark`): for V1, do not follow the system preference automatically. The default is always light mode unless the user has previously saved a dark preference. A future enhancement could default to the system preference on first visit.
- Multiple tabs: localStorage changes do not automatically sync across tabs. This is acceptable for V1.
