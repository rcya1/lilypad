# Feature: Customizable Font Size

## Overview
Let the user adjust the font size of both the markdown preview and the code editor independently. The setting is persisted in `localStorage`.

## User-Facing Behavior
- Two font size controls appear in the sidebar footer (alongside or near the dark mode toggle):
  - **Preview size**: adjusts the rendered markdown preview body text.
  - **Editor size**: adjusts the CodeMirror editor text size.
- Each control is a simple `–` / `+` button pair with the current size value between them (e.g. `– 15px +`).
- Size range: **12px – 24px**, step of **1px**.
- Changes apply immediately with no reload.
- Settings persist via `localStorage` keys `preview-font-size` and `editor-font-size`.
- Default values: `15px` for preview, `13px` for editor.

## What Needs to Change

### `src/stores/ui.ts` (extend existing — already has `previewVisible`)
- `previewFontSize` ref: initialized from `localStorage.getItem('preview-font-size')` parsed as int, defaulting to `15`.
- `editorFontSize` ref: initialized from `localStorage.getItem('editor-font-size')` parsed as int, defaulting to `13`.
- `setPreviewFontSize(size: number)` and `setEditorFontSize(size: number)` actions: clamp to [12, 24], update ref, write to localStorage.

### `src/components/editor/MarkdownPreview.vue`
- Apply `uiStore.previewFontSize` as a CSS custom property on the preview container: `:style="{ '--preview-font-size': uiStore.previewFontSize + 'px' }"`.
- In the preview's scoped CSS (or the existing markdown styles), set `font-size: var(--preview-font-size)` on the root prose container. All relative units (`em`) inside headings, code, etc. will scale automatically.

### `src/components/editor/TextEditor.vue`
- When `uiStore.editorFontSize` changes, dispatch a CodeMirror `reconfigure` effect that updates the editor's style. CodeMirror supports this via a `compartment` wrapping a theme extension:
  ```ts
  const fontSizeCompartment = new Compartment()
  // initial:
  fontSizeCompartment.of(EditorView.theme({ '&': { fontSize: '13px' } }))
  // on change:
  view.dispatch({ effects: fontSizeCompartment.reconfigure(EditorView.theme({ '&': { fontSize: `${size}px` } })) })
  ```
- Watch `uiStore.editorFontSize` and dispatch the reconfiguration.

### `src/components/sidebar/SidebarFooter.vue` (new component, or inline in LilypadSidebar)
- Layout: a slim row at the bottom of the sidebar with the dark mode toggle and font size controls.
- Font size controls: two labeled groups (`Preview` and `Editor`), each with `–` / current size label / `+` buttons.
- Buttons: small (`h-5 w-5`), `text-text-muted`, with `disabled` styling when at min/max.

## Edge Cases
- Invalid localStorage values (NaN, out-of-range): clamp on read, don't crash.
- CodeMirror editor not yet mounted when `editorFontSize` changes: the watcher should guard against dispatching on a null view ref.
