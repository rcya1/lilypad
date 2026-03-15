# Feature: Quick Switcher (Ctrl+P)

## Overview
A command-palette-style modal for rapidly opening any file by name. Triggered via `Ctrl+P`, it presents a fuzzy-searchable list of all files in the project. Selecting a file opens it as a tab.

## User-Facing Behavior
- `Ctrl+P` opens a centered modal overlay.
- The modal has a single text input, auto-focused, with placeholder "Go to file…".
- Below the input, a scrollable list of matching files appears instantly as the user types.
- Matching is fuzzy against the file name (not full path) — e.g. typing "rch" matches "Research.md".
- Each result row shows: file icon (colored by type), file name, and the folder path in muted text to the right.
- Results are ordered: exact prefix matches first, then fuzzy matches, then sorted alphabetically within each group.
- Up/Down arrow keys navigate the list; `Enter` opens the highlighted file; `Escape` closes the modal without opening anything.
- Clicking a result also opens the file.
- The modal closes automatically after a file is selected.
- Maximum 20 results shown at once (no pagination needed for V1).

## What Needs to Change

### `src/components/QuickSwitcher.vue` (new component)
- Modal overlay: fixed, full-screen, semi-transparent backdrop (`bg-black/30`), closes on backdrop click.
- Inner panel: centered card, `max-w-lg w-full`, `bg-surface`, rounded, shadowed.
- Text input at top: `w-full`, styled consistently with app inputs.
- Results list below: each row is a `<button>` with flex layout: icon left, filename center-left, folder path right (muted, truncated).
- Highlighted row: `bg-surface-elevated` background.
- Empty state: "No files match" when query is non-empty and results are empty.
- If query is empty: show all files (up to 20), most recently opened first (use `editorStore.tabOrder` as a recency hint — files that are currently open appear first).

### Fuzzy Match Logic
- Implement a simple inline fuzzy match: for query `q` and candidate `name`, check that all characters of `q` appear in order in `name` (case-insensitive). Score by how contiguous the match is.
- No external fuzzy library needed for V1.

### `src/stores/ui.ts` (extend existing — already has `previewVisible`)
- `quickSwitcherOpen` ref (boolean).
- `openQuickSwitcher()`, `closeQuickSwitcher()` actions.

### Global Keyboard Shortcut
- Register `Ctrl+P` in a global `keydown` listener in `App.vue` (alongside the existing `Ctrl+N` listener).
- Call `preventDefault()` on the event to suppress browser default behavior.

### `src/App.vue`
- Mount `<QuickSwitcher />` at the root level (outside the sidebar/editor layout) so it layers above everything.
- Show it conditionally via `uiStore.quickSwitcherOpen`.

### File Data Source
- Use `filesStore.entries` (the flat list of all `Entry` objects) filtered to `DocumentType` items only.
- File name comes from `entry.name`, folder path is resolved by walking the tree upward.

## Edge Cases
- Very large file lists (hundreds of files): the 20-result cap keeps rendering fast.
- `Ctrl+P` pressed when quick switcher is already open: close it (toggle behavior).
- File selected is already open in a tab: just set it as active, don't open a duplicate tab.
