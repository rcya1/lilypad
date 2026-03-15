# Known Issue: Browser Keyboard Shortcut Interception

## Problem

Certain keyboard shortcuts used by Lilypad are intercepted by the browser before they reach the app, making them impossible to trigger. This is a fundamental browser security/UX constraint — browsers reserve some key combinations for themselves and do not dispatch them to web page event listeners at all.

## Confirmed Broken Shortcuts

### `Ctrl+N` — New File
- **Intended behavior:** Open inline file creation input in the sidebar.
- **Actual behavior:** Opens a new browser window/tab instead.
- **Why:** `Ctrl+N` is a protected browser shortcut. Even with `e.preventDefault()` and `capture: true` on the listener, the browser acts on it before the event reaches JavaScript.
- **Status:** The listener and logic are implemented correctly in `App.vue` but the shortcut is unreachable in a standard browser environment.

### `Ctrl+W` — Close Tab (potential conflict)
- **Intended behavior:** Close the active editor tab.
- **Actual behavior:** Closes the current browser tab.
- **Why:** Same as above — `Ctrl+W` is a reserved browser shortcut.
- **Status:** Not currently assigned in Lilypad, but would have the same problem if added.

## Root Cause

Browsers explicitly block `preventDefault()` for a handful of OS/browser-level shortcuts:
- `Ctrl+N` / `Cmd+N` — new window
- `Ctrl+W` / `Cmd+W` — close tab
- `Ctrl+T` / `Cmd+T` — new tab
- `Ctrl+Shift+N` — incognito window (Chrome)
- `Alt+F4` — close window (Windows)
- `Cmd+Q` — quit app (macOS)

These are not interceptable in standard browser contexts regardless of event listener configuration.

## Not a Problem in Electron / Tauri

If Lilypad is ever packaged as a desktop app (Electron, Tauri, etc.), these shortcuts become freely usable since the shell's keyboard handling is fully controlled by the app. `Ctrl+N` and `Ctrl+W` could be registered as native menu accelerators.

## Workarounds to Consider

- **`Ctrl+N`:** Reassign new file to a non-conflicting shortcut, e.g. `Ctrl+Alt+N`, `Ctrl+Shift+N` (also browser-reserved on Chrome for incognito — avoid), or a custom chord.
- **`Ctrl+W`:** Leave unassigned unless a safe alternative chord is chosen.
- **Alternative UX:** The "New File" button in the sidebar header already provides a mouse-accessible path. The shortcut is a nice-to-have, not a blocker.
