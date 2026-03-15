# Feature: Image Paste

## Overview
When the user pastes an image (from clipboard) while the editor is focused, automatically upload it to Supabase Storage and insert the resulting markdown image link at the cursor position.

## User-Facing Behavior
- User copies an image (screenshot, browser drag, etc.) and presses `Ctrl+V` / `Cmd+V` in the editor.
- The editor immediately inserts a placeholder: `![Uploading image…]()` at the cursor.
- Once the upload completes, the placeholder is replaced with the real markdown: `![image](https://…/filename.png)`.
- If the upload fails, the placeholder is removed and a toast error is shown: "Image upload failed."
- Non-image paste events (plain text, HTML) behave exactly as before — this only intercepts `ClipboardEvent` items with `type` starting with `image/`.
- Supported image types: whatever Supabase Storage accepts (png, jpg, gif, webp at minimum).

## What Needs to Change

### `src/components/editor/TextEditor.vue`
- Add a `paste` event listener on the CodeMirror editor DOM element (or use a CodeMirror `EditorView.domEventHandlers` extension).
- In the handler:
  1. Check `event.clipboardData.items` for any item where `item.type.startsWith('image/')`.
  2. If found, call `event.preventDefault()` to suppress the default paste behavior.
  3. Get the file via `item.getAsFile()`.
  4. Generate a filename: `image-{timestamp}.{ext}` where ext is derived from `item.type` (e.g. `image/png` → `png`).
  5. Insert the placeholder text `![Uploading image…]()` at the current cursor position via a CodeMirror `transaction`.
  6. Call `filesStore.uploadImage(file, filename)` (new action — see below).
  7. On success: replace the placeholder with `![image](url)` via another CodeMirror transaction. The transaction must find the exact placeholder string and replace it (use a search-and-replace dispatch on the editor view).
  8. On failure: remove the placeholder and show a toast error.

### `src/stores/files.ts`
- Add `uploadImage(file: File, filename: string): Promise<string>` action.
- Uploads to a dedicated path in Supabase Storage, e.g. `user-images/{userId}/{filename}`.
- Returns the public URL of the uploaded file.
- Throws on error so the caller can handle it.

## Edge Cases
- Multiple images pasted at once: handle only the first image item found; ignore subsequent items in the same paste event.
- Pasting while no document is open: guard against this — if `activeDocumentId` is null, do nothing.
- Very large images: no client-side size check required for V1, but the Supabase Storage bucket policy may reject oversized files — surface the error via toast.
- The `![Uploading image…]()` placeholder must be unique enough to replace correctly. If the user pastes two images in quick succession before either finishes uploading, each gets a unique placeholder by appending a random suffix: `![Uploading image-{random}…]()`.
