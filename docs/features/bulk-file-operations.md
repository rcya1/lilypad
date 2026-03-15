# Feature: Bulk File Operations

## Overview
Allow the user to select multiple files in the file explorer and perform batch actions (delete, move to folder) on all selected files at once.

## User-Facing Behavior

### Selection
- `Ctrl+Click` on a file adds it to the selection (or removes it if already selected).
- `Shift+Click` selects a contiguous range of files between the last-clicked item and the current one (within the same folder level).
- Clicking a file without modifier clears the selection and selects only that file (standard single-select behavior is unchanged).
- Selected files show a distinct background (`bg-surface-overlay`) and a subtle checkbox indicator on the left side of the row.
- Folders cannot be selected for bulk operations in V1 — only document entries.

### Bulk Action Bar
- When 2 or more files are selected, a floating action bar appears at the bottom of the sidebar.
- The bar shows: "X files selected" label, a **Move** button (folder icon), and a **Delete** button (trash icon, red/destructive styled).
- Clicking outside all file rows (but still within the file explorer) clears the selection and hides the bar.

### Delete
- Clicking **Delete** in the bulk action bar shows a single confirm dialog: "Delete X files? This cannot be undone." with Cancel / Delete buttons.
- On confirm, calls `filesStore.deleteDocument(id)` for each selected file sequentially (or in parallel — parallel is fine since these are independent operations).
- After deletion, the selection is cleared and the action bar hides.
- If any deletions fail, show a toast: "Failed to delete some files."

### Move
- Clicking **Move** opens a folder picker modal: a simple tree of all folders in the project.
- The user selects a destination folder and clicks "Move here".
- Calls `filesStore.moveDocument(id, targetFolderId)` for each selected file.
- After completion, the selection is cleared.

## What Needs to Change

### `src/stores/files.ts`
- Add `selectedFileIds` ref: `Set<string>`.
- Add actions: `selectFile(id)`, `deselectFile(id)`, `toggleFileSelection(id)`, `setSelection(ids: string[])`, `clearSelection()`.
- Add `isFileSelected(id: string): boolean` getter.

### `src/components/sidebar/FileExplorerNode.vue`
- Handle `click` with modifier key detection:
  - `e.ctrlKey` (or `e.metaKey` on Mac): toggle selection for the clicked file.
  - `e.shiftKey`: range-select (requires knowing the last-clicked index in the flat file list — see below).
  - No modifier: single-select (clear others, select this one) only if in selection mode; otherwise normal open behavior.
- Show selected state: `bg-surface-overlay` row background when `filesStore.isFileSelected(id)`.
- Add a small checkbox or selection indicator on the left when any files are selected (show the checkbox column only when selection mode is active — i.e., `selectedFileIds.size > 0`).

### Range Selection
- Maintain a `lastClickedFileId` ref in `filesStore` (or a sidebar composable).
- When shift+click occurs, resolve the flat ordered list of all visible document entries in the current tree, find the indices of `lastClickedFileId` and the clicked file, and select all entries in that range.

### `src/components/sidebar/BulkActionBar.vue` (new component)
- Fixed to the bottom of the sidebar container (`absolute bottom-0 left-0 right-0` or `sticky`).
- Shows count, Move button, Delete button.
- Conditionally rendered when `filesStore.selectedFileIds.size >= 2`.

### `src/components/sidebar/FolderPickerModal.vue` (new component)
- Simple modal with a tree of folders (no files shown).
- Each folder row is clickable to select it as the destination.
- "Move here" button confirms.
- "Cancel" closes without action.

### `src/components/sidebar/LilypadSidebar.vue`
- Mount `<BulkActionBar>` inside the sidebar container with relative positioning so it overlays the bottom of the file list.
- Add padding-bottom to the file explorer scroll container equal to the action bar height when it is visible, to prevent content from being hidden behind it.

## Edge Cases
- Selecting a file that is currently open in a tab and then deleting it: close the tab first (or after deletion, close any tabs whose ids are in the deleted set).
- Moving a file that is open in a tab: update `editorStore.openDocuments` with the new folder path if the display name changes (it shouldn't, since name is unchanged — but verify the file id remains stable after a move).
- All selected files are deleted from under the user by another session (Supabase realtime, future feature): handle 404 errors from delete calls gracefully with a toast.
