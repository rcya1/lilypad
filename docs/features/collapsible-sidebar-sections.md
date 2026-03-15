# Feature: Collapsible Sidebar Sections

## Overview
Add a "Collapse All" / "Expand All" toggle to the sidebar header that collapses or expands all folders in the file explorer at once. Individual folder expand/collapse is already supported; this adds a single control for bulk state.

## User-Facing Behavior
- A `ChevronsDownUp` icon button (lucide, 15px) in the sidebar header toggles between "Collapse All" and "Expand All".
- **Collapse All**: all folders in the tree collapse simultaneously (their children are hidden).
- **Expand All**: all folders expand to show their direct children (one level, not recursive expand — see note below).
- The icon changes to indicate the current action: `ChevronsDownUp` (collapse) when any folder is expanded; `ChevronsUpDown` (expand) when all are collapsed.
- The state of individual folders is still controlled per-folder after the bulk action — if the user manually re-expands a folder after collapsing all, only that folder is expanded.
- The collapsed/expanded state of folders is **not** persisted across sessions for V1 (folders default to expanded on load).

## What Needs to Change

### `src/stores/files.ts`
- Add `collapsedFolderIds` ref: `Set<string>` — tracks which folder ids are currently collapsed.
- Add `toggleFolder(id: string)` action: adds or removes `id` from `collapsedFolderIds`.
- Add `collapseAll()` action: adds all folder ids (from `filesStore.entries` filtered to directories) to `collapsedFolderIds`.
- Add `expandAll()` action: clears `collapsedFolderIds`.
- Add `isFolderCollapsed(id: string): boolean` getter.

### `src/components/sidebar/FileExplorerNode.vue`
- Replace the local `isExpanded` ref (if it exists as component state) with `!filesStore.isFolderCollapsed(entry.id)` so the store is the source of truth.
- On folder click (chevron/row click): call `filesStore.toggleFolder(entry.id)`.

### `src/components/sidebar/LilypadSidebar.vue` (or sidebar header component)
- Add the collapse/expand all button to the sidebar header row alongside any existing header controls.
- Compute `anyExpanded`: `filesStore.collapsedFolderIds.size < totalFolderCount`.
- Button: `@click="anyExpanded ? filesStore.collapseAll() : filesStore.expandAll()"`.
- Icon: `ChevronsDownUp` when `anyExpanded`, `ChevronsUpDown` when all collapsed.
- Tooltip (via `title` attribute): "Collapse all" / "Expand all".

## Edge Cases
- New folders created after a "Collapse All": newly created folders should default to expanded (not in `collapsedFolderIds`) since the user just created them and presumably wants to see their contents.
- Empty folder tree (no folders, only root-level files): the button is still visible but effectively a no-op.
- Deep nesting: "Expand All" only removes all ids from `collapsedFolderIds`, which means every folder becomes expanded including deeply nested ones. This is intentional — the user asked to expand everything.
