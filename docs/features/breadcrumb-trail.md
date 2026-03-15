# Feature: Breadcrumb Trail

## Overview
Display the folder path of the currently active file above the editor, between the tab bar and the editor/preview content. Gives the user spatial context when working with deeply nested files.

## User-Facing Behavior
- A slim breadcrumb bar appears between `EditorTabs` and the split-pane content area.
- It shows the full folder hierarchy leading to the active file, e.g.: `Notes  /  Research  /  Physics`
- The final segment is the file name, styled slightly more prominently (or in `text-text-primary` vs `text-text-muted` for separators and ancestor folders).
- Each ancestor folder segment is clickable: clicking it selects (highlights) that folder in the sidebar file explorer.
- The bar is hidden when no tab is active.
- If the path is too long to fit, it truncates from the left with an ellipsis (e.g., `… / Research / Physics`), keeping the file name always visible.

## What Needs to Change

### `src/components/editor/BreadcrumbBar.vue` (new component)
- Receives the active document's folder path as a computed prop derived from `filesStore.tree` + `editorStore.activeDocumentId`.
- Renders a flex row of folder segments separated by `/` dividers (use `ChevronRight` icon at 12px or a plain `/` text separator — designer's choice, plain `/` is cleaner here).
- Folder segments: `<button class="text-text-muted text-xs font-ui hover:text-text-secondary">` — clicking emits a `select-folder` event with the folder id.
- File name segment: `<span class="text-text-secondary text-xs font-ui font-medium">`.
- Container: `h-7 px-3 flex items-center gap-1 border-b border-border-subtle bg-surface shrink-0 overflow-hidden`.

### Path Resolution
- Add a helper (in `filesStore` or a utility) `getAncestorPath(fileId: string): { id: string, name: string }[]` that walks the tree from root to the file's parent folders and returns the ordered list of ancestor directory entries.
- This can be derived from `filesStore.tree` (the computed nested tree structure).

### `src/components/editor/EditorPane.vue`
- Import and render `<BreadcrumbBar>` between `<EditorTabs>` and the split pane `<div>`.
- Only render it when `hasTabs` is true and `activeDocumentId` is non-null.
- Handle the `select-folder` event by calling `filesStore.setSelectedFolder(folderId)` (or equivalent).

### Sidebar Sync
- When a breadcrumb folder is clicked, the sidebar should expand and scroll to that folder.
- `filesStore.setSelectedFolder(id)` should set a `selectedFolderId` ref that the file explorer already uses (if it exists) or is added here.
- Auto-expand ancestor folders in the file explorer so the selected folder is visible.

## Edge Cases
- File at root level (no parent folder): show only the file name, no folder segments, no separator.
- Very long folder names: each segment has `max-w-[120px] truncate` to prevent any one segment from consuming the whole bar.
- Active document changes (tab switch): breadcrumb updates reactively via the `activeDocumentId` watcher.
