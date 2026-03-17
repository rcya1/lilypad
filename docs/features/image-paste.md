# Feature: Image Paste & Image Management

## Overview

Paste or drag images into the markdown editor. Images upload to Supabase Storage in the background while an immutable, repositionable spinner widget shows progress inline. On completion the widget transforms into standard markdown image syntax with sizing, centering, and caption support. A future Photos Tab (V2) adds browsing, organizing, and hard-linking images across notes.

---

## V1 — Core Image Paste

### 1. Paste / Drop Handler

**Where:** `src/components/editor/TextEditor.vue`

Add a new entry to the `EditorView.domEventHandlers` extension (already used for other handlers in this file):

```ts
paste(event: ClipboardEvent, view: EditorView) {
  const items = event.clipboardData?.items
  if (!items) return false

  // Check if any pasted text is a sentinel being re-pasted (see §3.5)
  const text = event.clipboardData?.getData('text/plain') ?? ''
  const sentinelMatch = text.match(/^<!--uploading:([a-f0-9-]+)-->$/)
  if (sentinelMatch) {
    // Re-paste of a previously cut/copied sentinel — see §3.5
    event.preventDefault()
    reinsertSentinel(view, sentinelMatch[1])
    return true
  }

  // Look for image items
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault()
      const file = item.getAsFile()
      if (file) startImageUpload(view, file)
      return true  // only handle the first image
    }
  }

  return false  // not an image paste — let CodeMirror handle normally
}
```

**Drop support (optional, same pattern):** Listen for `drop` events, check `event.dataTransfer.files` for image types.

**Guard:** If `editorStore.activeDocumentId` is null, return false immediately.

**Supported types:** Any `type.startsWith('image/')` — typically `image/png`, `image/jpeg`, `image/gif`, `image/webp`. We don't filter; Supabase Storage will reject unsupported types and we surface that as a toast.

### 2. Upload to Supabase Storage

**Where:** `src/stores/files.ts` — new action.

```ts
async function uploadImage(file: File, documentId: string): Promise<string> {
  if (!auth.user) throw new Error('Not authenticated')

  const ext = file.type.split('/')[1] ?? 'png'  // image/png → png
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 6)
  const filename = `image-${timestamp}-${random}.${ext}`
  const storagePath = `${auth.user.id}/images/${documentId}/${filename}`

  const { error } = await supabase.storage
    .from('user-files')  // reuse existing bucket
    .upload(storagePath, file, { contentType: file.type })

  if (error) throw error

  const { data: urlData } = supabase.storage
    .from('user-files')
    .getPublicUrl(storagePath)

  return urlData.publicUrl
}
```

**Storage path structure:** `{userId}/images/{documentId}/{filename}`
- Scoped per-user for RLS isolation (same pattern as existing document storage).
- Scoped per-document so images are co-located with the note that created them.
- The `images/` segment distinguishes image files from document files (`{userId}/{entryId}.md`).

**Bucket:** Reuses `user-files` (already exists). No new bucket needed.

**No client-side size limit:** Rely on Supabase bucket policy. If the upload fails (too large, wrong type, network error), the error propagates to the caller which shows a toast and cleans up the sentinel.

**Return value:** The public URL of the uploaded file (e.g., `https://xxx.supabase.co/storage/v1/object/public/user-files/{userId}/images/{docId}/image-1742123456-a3f1.png`).

### 3. Immutable Upload Placeholder (CodeMirror Widget)

**Goal:** While the image uploads, show a spinner in the editor that the user cannot accidentally delete but _can_ reposition by cutting and pasting.

There are four pieces that work together: a sentinel string in the document, a decoration that visually replaces it, a transaction filter that protects it, and a detached map that keeps the upload alive even when the sentinel is temporarily absent.

#### 3.1. Sentinel insertion

When the paste handler intercepts an image, it generates a UUID and inserts a sentinel comment into the document at the cursor:

```ts
function startImageUpload(view: EditorView, file: File) {
  const uuid = crypto.randomUUID()
  const sentinel = `<!--uploading:${uuid}-->`
  const cursor = view.state.selection.main.head

  // Insert sentinel at cursor
  view.dispatch({
    changes: { from: cursor, insert: sentinel + '\n' },
  })

  // Start upload, store promise in detached map
  const documentId = editorStore.activeDocumentId!
  const promise = filesStore.uploadImage(file, documentId)
  detachedUploads.set(uuid, { promise, documentId })

  // Handle completion
  promise
    .then((url) => onUploadSuccess(view, uuid, url))
    .catch(() => onUploadFailure(view, uuid))
}
```

The sentinel is a single line: `<!--uploading:a1b2c3d4-...-->`. It's a valid HTML comment, so if it somehow leaks into the final markdown, it renders as invisible rather than broken.

#### 3.2. Replace decoration (spinner widget)

A `StateField<DecorationSet>` scans the document for sentinel patterns and creates a `Decoration.replace` for each one. The replace decoration hides the sentinel text and draws a widget in its place.

```ts
// Module-level
const sentinelPattern = /<!--uploading:[a-f0-9-]+-->/g

const uploadWidgetField = StateField.define<DecorationSet>({
  create(state) { return buildDecorations(state) },
  update(decos, tr) {
    if (tr.docChanged) return buildDecorations(tr.state)
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

function buildDecorations(state: EditorState): DecorationSet {
  const builder: Range<Decoration>[] = []
  const doc = state.doc.toString()
  let match: RegExpExecArray | null
  sentinelPattern.lastIndex = 0
  while ((match = sentinelPattern.exec(doc)) !== null) {
    builder.push(
      Decoration.replace({ widget: new UploadSpinnerWidget() })
        .range(match.index, match.index + match[0].length)
    )
  }
  return Decoration.set(builder, true)
}
```

**The `UploadSpinnerWidget` class** extends `WidgetType` and renders a styled inline-block element:

```ts
class UploadSpinnerWidget extends WidgetType {
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-upload-spinner'
    wrap.setAttribute('contenteditable', 'false')
    // Spinner icon (CSS animation)
    const spinner = document.createElement('span')
    spinner.className = 'cm-upload-spinner-icon'
    wrap.appendChild(spinner)
    // Label
    const label = document.createElement('span')
    label.className = 'cm-upload-spinner-label'
    label.textContent = 'Uploading image…'
    wrap.appendChild(label)
    return wrap
  }

  ignoreEvent() { return true }
}
```

**CSS** (in TextEditor.vue `<style>` block, unscoped since CM lives in a shadow-free DOM):

```css
.cm-upload-spinner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-family-ui);
  font-size: 12px;
  color: var(--text-secondary);
  user-select: none;
}

.cm-upload-spinner-icon {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: cm-spinner-spin 0.8s linear infinite;
}

@keyframes cm-spinner-spin {
  to { transform: rotate(360deg); }
}
```

This looks like a small pill/badge with a spinning circle and "Uploading image..." text. It sits inline where the sentinel is, taking up one line of the editor.

#### 3.3. Transaction filter (immutability)

A `transactionFilter` inspects every transaction before it's applied. If a change would partially overlap a sentinel range, that change is rejected. Full deletions (the entire sentinel removed as a unit) are allowed — this is how cut/delete + re-paste works.

```ts
const sentinelGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr

  const doc = tr.startState.doc.toString()
  const sentinels: { from: number; to: number }[] = []
  sentinelPattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = sentinelPattern.exec(doc)) !== null) {
    sentinels.push({ from: m.index, to: m.index + m[0].length })
  }

  if (sentinels.length === 0) return tr

  // Check each change in the transaction
  let dominated = true
  tr.changes.iterChanges((fromA, toA) => {
    for (const s of sentinels) {
      const overlaps = fromA < s.to && toA > s.from
      const coversEntire = fromA <= s.from && toA >= s.to
      if (overlaps && !coversEntire) {
        // Partial overlap — this transaction is modifying part of a sentinel
        dominated = false
      }
    }
  })

  if (!dominated) {
    // Block the transaction — return an empty transaction
    return []
  }
  return tr
})
```

**What this means for the user:**
- Typing with the cursor inside the spinner → blocked (partial overlap with sentinel range).
- Backspacing from just after the spinner → blocked (deletes the last character of the sentinel, which is partial).
- Selecting the entire spinner line and pressing Delete or Ctrl+X → allowed (covers the full sentinel range).
- Selecting a range that includes the spinner plus surrounding text → allowed (covers the full sentinel).
- Normal typing before or after the spinner → allowed (no overlap).

#### 3.4. Detached uploads map

A module-level map tracks all in-flight uploads by UUID, independent of whether the sentinel is in the document:

```ts
// Module-level in TextEditor.vue
const detachedUploads = new Map<string, {
  promise: Promise<string>
  documentId: string
}>()
```

When an upload starts, its entry is added to this map. When the upload resolves (success or failure), the entry is removed. The sentinel can be deleted and re-pasted freely during this time — the upload is unaffected.

#### 3.5. Repositioning — delete and re-paste

When the user cuts or deletes a sentinel, the transaction filter allows it (full deletion). The sentinel text is now either on the clipboard (cut) or gone (delete). The upload continues in the detached map.

**On re-paste:** The paste handler (§1) checks if the pasted text matches the sentinel pattern. If it does:

```ts
function reinsertSentinel(view: EditorView, uuid: string) {
  // Only re-insert if this UUID is still in the detached map (upload in progress)
  if (!detachedUploads.has(uuid)) return

  const sentinel = `<!--uploading:${uuid}-->`
  const cursor = view.state.selection.main.head
  view.dispatch({
    changes: { from: cursor, insert: sentinel + '\n' },
  })
  // The StateField's update method will detect the new sentinel
  // and create a replace decoration (spinner) automatically
}
```

The spinner reappears at the new cursor position. When the upload completes, it finds the sentinel in the document and replaces it there.

**If pasted multiple times:** The `onUploadSuccess` handler searches the document for the sentinel pattern with this UUID. It replaces the first occurrence and removes any additional occurrences.

**If never re-pasted:** The upload completes, `onUploadSuccess` searches the document, finds nothing, and silently discards. The image sits in storage and is eventually garbage-collected (V2 Phase 6).

#### 3.6. Upload completion handlers

```ts
function onUploadSuccess(view: EditorView, uuid: string, url: string) {
  detachedUploads.delete(uuid)
  const sentinel = `<!--uploading:${uuid}-->`
  const doc = view.state.doc.toString()
  const idx = doc.indexOf(sentinel)

  if (idx === -1) return  // sentinel gone — silently discard

  // Build the replacement markdown
  // Extract a short name from the URL filename (strip extension + random suffix)
  const urlFilename = url.split('/').pop() ?? 'image'
  const displayName = urlFilename.replace(/\.[^.]+$/, '')
  const markdown = `![${displayName}](${url})`

  // Replace sentinel with markdown, select the alt text for easy renaming
  const altStart = idx + 2  // position of display name after "!["
  const altEnd = altStart + displayName.length

  view.dispatch({
    changes: {
      from: idx,
      to: idx + sentinel.length + 1,  // +1 for the trailing newline
      insert: markdown + '\n',
    },
    // After the replacement, select the alt text
    selection: { anchor: idx + 2, head: idx + 2 + displayName.length },
  })
}

function onUploadFailure(view: EditorView, uuid: string) {
  detachedUploads.delete(uuid)
  const sentinel = `<!--uploading:${uuid}-->`
  const doc = view.state.doc.toString()
  const idx = doc.indexOf(sentinel)

  if (idx !== -1) {
    // Remove sentinel + trailing newline
    view.dispatch({
      changes: { from: idx, to: idx + sentinel.length + 1, insert: '' },
    })
  }

  useToastStore().addToast('Image upload failed.', 'error')
}
```

**Note on the selection:** After the dispatch, the cursor sits inside `![displayName](url)` with `displayName` selected. The user can immediately type to replace it with a meaningful caption.

### 4. Image Sizing Syntax

**Where:** `src/lib/markdown.ts` — new `walkTokens` hook + custom image renderer.

Custom attribute syntax appended after the image markdown, using curly braces:

```markdown
![caption](url){w-500}
![caption](url){h-300}
![caption](url){w-auto}
![caption](url){w-1/2}
```

#### Supported attributes

| Attribute | CSS output | Example |
|-----------|-----------|---------|
| `w-<px>` | `width: <px>px` | `{w-500}` → 500px wide |
| `h-<px>` | `height: <px>px` | `{h-300}` → 300px tall, auto width |
| `w-auto` | `width: auto` | Natural image size |
| `w-1/2` | `width: 50%` | Half container width |
| `w-1/3` | `width: 33.333%` | Third of container |
| `w-2/3` | `width: 66.667%` | Two-thirds of container |
| `w-full` | `width: 100%` | Full container width |

Only one dimension attribute per image. If both `w-` and `h-` are present, the first one wins.

**Default (no `{...}` attribute):** `w-full` — images stretch to fill the preview content area.

#### Implementation: `walkTokens` + renderer override

The `{...}` syntax is not standard markdown, so `marked` won't parse it as part of the image token. Instead, we use `walkTokens` to post-process image tokens and check if the text immediately after the image in the parent token's raw source contains a `{...}` block.

```ts
// In parseMarkdown(), add to the marked.use() chain:
marked.use({
  walkTokens(token) {
    if (token.type === 'image') {
      // Check the raw source for a trailing {attr}
      // token.raw is e.g. '![caption](url){w-500}'
      const attrMatch = token.raw.match(/\{(w-[^\}]+|h-[^\}]+)\}\s*$/)
      if (attrMatch) {
        (token as any)._imageSize = attrMatch[1]  // e.g. 'w-500'
      }
    }
  },
  renderer: {
    image(token) {
      const sizeAttr = (token as any)._imageSize as string | undefined
      const style = parseSizeToCSS(sizeAttr)
      const isDefaultName = /^image-\d+/.test(token.text)
      const caption = isDefaultName ? '' : token.text

      const imgTag = `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}" style="${style}" />`
      const captionTag = caption
        ? `<figcaption>${escapeHtml(caption)}</figcaption>`
        : ''

      return `<figure class="image-container">${imgTag}${captionTag}</figure>`
    },
  },
})

function parseSizeToCSS(attr: string | undefined): string {
  if (!attr) return 'width: 100%;'  // default: full width

  if (attr === 'w-auto') return 'width: auto;'
  if (attr === 'w-full') return 'width: 100%;'
  if (attr === 'w-1/2') return 'width: 50%;'
  if (attr === 'w-1/3') return 'width: 33.333%;'
  if (attr === 'w-2/3') return 'width: 66.667%;'

  const wMatch = attr.match(/^w-(\d+)$/)
  if (wMatch) return `width: ${wMatch[1]}px;`

  const hMatch = attr.match(/^h-(\d+)$/)
  if (hMatch) return `height: ${hMatch[1]}px; width: auto;`

  return 'width: 100%;'  // unrecognized → default
}
```

**Important:** The `walkTokens` approach works because `marked` includes the `{...}` text in the image token's `raw` property even though it doesn't parse it. The regex consumes it from `raw` and attaches metadata to the token before the renderer runs.

If `marked` does _not_ include the `{...}` in the image token's `raw` (because it stops parsing at the `)`) — then we need a different approach: a custom tokenizer extension that matches the full `![...](url){attr}` pattern, or a post-processing step that merges the `{...}` text token with the preceding image token. This should be verified during Phase 4 implementation.

### 5. Centered Rendering with Captions

**Where:** `src/components/editor/MarkdownPreview.vue` — add to the existing `:deep()` scoped styles for `v-html` content.

All images render centered, wrapped in `<figure>` (emitted by the image renderer in §4):

```css
:deep(.image-container) {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 1.5em auto;
}

:deep(.image-container img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

:deep(.image-container figcaption) {
  margin-top: 0.5em;
  font-size: 0.85em;
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
}
```

**Caption behavior:**
- Alt text is used as the caption: `![This is my photo](url)` → caption "This is my photo".
- If the alt text matches the default generated name pattern (`image-{timestamp}-{random}`), no `<figcaption>` is emitted — no caption shown.
- The `<figure>` is always centered (`margin: auto`), regardless of the image width.

### 6. Right-Click Rename

**Where:** `src/components/editor/TextEditor.vue` — add a context menu handler.

Right-clicking on an image link in the editor shows a custom context menu with "Rename image." Selecting it places the cursor inside the alt-text brackets and selects the current name.

**Detection:** On `contextmenu` event, check if the click position (mapped to a document offset via `view.posAtCoords`) falls within an image token. To find image tokens, scan the line at the click position for the pattern `!\[...\](...)`:

```ts
contextmenu(event: MouseEvent, view: EditorView) {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos === null) return false

  const line = view.state.doc.lineAt(pos)
  const lineText = line.text
  const imagePattern = /!\[([^\]]*)\]\([^)]+\)/g
  let match: RegExpExecArray | null
  while ((match = imagePattern.exec(lineText)) !== null) {
    const absFrom = line.from + match.index
    const absTo = absFrom + match[0].length
    if (pos >= absFrom && pos <= absTo) {
      // Click is inside this image syntax
      event.preventDefault()
      showImageContextMenu(event, view, {
        altFrom: absFrom + 2,  // after "!["
        altTo: absFrom + 2 + match[1].length,  // end of alt text
      })
      return true
    }
  }
  return false
}
```

**Context menu UI:** A small floating div (same style as the file explorer context menu) with one option: "Rename image." On click, it selects the alt text range:

```ts
view.dispatch({
  selection: { anchor: altFrom, head: altTo },
})
view.focus()
```

This is a convenience — the user can also manually click into `[...]` and edit.

---

## V2 — Photos Tab

A dedicated sidebar tab for browsing and managing all uploaded images.

### 7. Photos Tab UI

**Where:** New files:
- `src/components/sidebar/PhotosTab.vue` — the tab component
- `src/stores/images.ts` — Pinia store for image metadata

**Tab switching:** `LilypadSidebar.vue` gets a tab bar at the top of the sidebar with two tabs: "Files" (current file explorer) and "Photos" (new). Only one is visible at a time. The tab bar is a simple row of two buttons; the active tab has an accent underline (same pattern as editor tabs).

**Layout:** The Photos Tab mirrors the file explorer's folder tree, but filtered to show only folders that contain images, and the leaf nodes are images instead of documents.

```
Photos
├── Lecture Notes/
│   ├── image-1742123456.png
│   └── screenshot-2.jpg
├── Homework/
│   └── diagram.png
└── Unsorted/
    └── image-1742199999.webp
```

- Each image shows a small thumbnail (lazy-loaded, ~40px) and the image name.
- "Unsorted" is a virtual folder at the root containing images whose parent document no longer exists or that were uploaded but never referenced.
- Folder structure is derived from the document folder structure: an image at path `{userId}/images/{documentId}/file.png` inherits the folder location of `documentId` in the file explorer.

**Data source:** On mount, the store lists all files in `user-files/{userId}/images/` via `supabase.storage.from('user-files').list(...)`. For each image, it resolves the parent document's folder path using the entries in `filesStore`.

### 8. Hard Links — Drag Image into Editor

Dragging an image thumbnail from the Photos Tab into the CodeMirror editor inserts a markdown image link.

**Implementation:**
- The thumbnail element has `draggable="true"`.
- `dragstart` sets `event.dataTransfer` with `text/plain` data containing the markdown: `![image-name](public-url)`.
- CodeMirror's default drop handler inserts the text at the drop position.
- This means the same image URL now appears in multiple documents — a "hard link." The image exists once in storage.

### 9. Ctrl+Click Navigation

**Where:** `src/components/editor/TextEditor.vue` — click handler.

In the editor, Ctrl+clicking (Cmd+click on Mac) on an image link navigates to that image in the Photos Tab.

**Detection:** On `click` event, check for `event.ctrlKey || event.metaKey`. If true, check if the click position falls within an image link (same pattern matching as §6). Extract the URL, then:

```ts
// Switch to Photos Tab and highlight the image
imagesStore.navigateToImage(url)
```

The `navigateToImage` action in the images store:
1. Sets the active sidebar tab to "Photos" (via `uiStore` or a shared ref).
2. Finds the image entry matching the URL.
3. Expands the parent folder if collapsed.
4. Scrolls to and visually highlights the image (e.g., a brief accent background flash, same as the editor's line highlight).

### 10. Image Renaming

**Two entry points, same underlying operation:**

**From Photos Tab:** Right-click an image → "Rename" → inline input replaces the name (same UX as file explorer's `isRenaming` pattern in `FileExplorerNode.vue`). This renames the **display name** (stored in the images store metadata), not the storage filename.

**From editor:** Right-click on `![name](url)` → "Rename image" → selects the alt text for editing (same as §6). This only changes the alt text in the current document.

**Sync between Photos Tab rename and editor alt text:** When the user renames an image from the Photos Tab, the store scans all open documents for markdown image links with the matching URL and updates the alt text in each one. This is done by:
1. Iterating `editorStore.openDocuments`.
2. For each document's content, find `![old-name](url)` and replace with `![new-name](url)`.
3. Dispatch the replacement as a CodeMirror transaction (if the editor view is mounted) or update the stored content string directly.

### 11. Image Deletion & Garbage Collection

Images use a **reference-counted soft-delete** model.

#### Database schema

New table: `image_refs`

```sql
create table image_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  document_id uuid references entries(id) on delete set null,
  display_name text not null default '',
  unreferenced_at timestamptz,  -- null while referenced; set when ref count → 0
  created_at timestamptz not null default now()
);

-- RLS: users can only see/modify their own rows
alter table image_refs enable row level security;
create policy "Users manage own images" on image_refs
  for all using (auth.uid() = user_id);

-- Index for garbage collection query
create index idx_image_refs_gc on image_refs (unreferenced_at)
  where unreferenced_at is not null;
```

**Row lifecycle:**
1. **Created** when an image is uploaded (`uploadImage` inserts a row with `document_id` = the uploading document, `unreferenced_at` = null).
2. **Reference tracking:** Whenever a document is saved, scan its content for image URLs. For each image URL found, ensure an `image_refs` row exists with that `document_id`. Remove rows for images no longer in the content.
3. **Unreferenced:** When the last `image_refs` row for a `storage_path` has its `document_id` set to null (document deleted) or the row is deleted (image removed from content), set `unreferenced_at = now()`.
4. **Re-referenced:** If a new reference appears (image dragged into a note, undo, etc.), set `unreferenced_at = null`.
5. **Garbage collected:** A cleanup process deletes rows where `unreferenced_at < now() - interval '7 days'` and removes the corresponding files from storage.

#### Garbage collection

**Option A — Supabase Edge Function (preferred):**

```ts
// supabase/functions/image-cleanup/index.ts
// Runs on a cron schedule (e.g., daily at 3am UTC)
// 1. Query: SELECT storage_path FROM image_refs
//           WHERE unreferenced_at < now() - interval '7 days'
// 2. Delete storage files: supabase.storage.from('user-files').remove(paths)
// 3. Delete the rows: DELETE FROM image_refs WHERE id IN (...)
```

**Option B — Client-side (fallback):** On app load, run the same query for the current user and clean up their orphaned images. Less reliable (user might not open the app) but requires no server infrastructure.

#### Direct delete from Photos Tab

Right-click → "Delete" → confirm dialog → immediately:
1. Delete the storage file.
2. Delete the `image_refs` row.
3. Any notes still referencing the URL will show a broken image. This is intentional — the user explicitly chose to delete.

#### UI indicators

In the Photos Tab, unreferenced images (those with `unreferenced_at` set) appear:
- Dimmed (50% opacity).
- With a small badge: "Unused — deleted in X days" (computed from `unreferenced_at + 7 days - now()`).

---

## Implementation Phases

Each phase is independently shippable and testable. Phases build on each other sequentially.

### Phase 1: Basic Paste + Upload

**Scope:** Paste an image, upload it, insert markdown. Simple text placeholder (`![Uploading…]()`) while uploading — no widget system yet.

**Files to create/modify:**
- `src/stores/files.ts` — add `uploadImage(file, documentId)` action
- `src/components/editor/TextEditor.vue` — add paste handler in `domEventHandlers`, insert placeholder text, replace on completion

**Implementation notes:**
- Use a simple text placeholder: `![Uploading image…]()` with a random suffix for uniqueness.
- On success: search the document for the placeholder string and replace it with `![name](url)`.
- On failure: search and remove the placeholder, show toast.
- This is intentionally simple — Phase 2 replaces the placeholder mechanism entirely.

**What to test:**
- Paste a screenshot → placeholder appears immediately → real image markdown appears after upload → image visible in preview
- Paste text / code → normal paste behavior, no interference
- Paste while no document is open → nothing happens
- Upload failure (e.g., disconnect wifi) → placeholder removed, toast error shown
- Paste two images rapidly → both get unique placeholders, both upload and insert correctly
- Paste a very large image → Supabase rejects it, toast error, placeholder cleaned up

### Phase 2: Immutable Widget Placeholder

**Scope:** Replace the simple text placeholder from Phase 1 with the full sentinel + decoration + transaction filter system described in §3.

**Files to create/modify:**
- `src/components/editor/TextEditor.vue`:
  - Add `uploadWidgetField` StateField (§3.2) to the extensions array
  - Add `sentinelGuard` transactionFilter (§3.3) to the extensions array
  - Add `UploadSpinnerWidget` class (§3.2)
  - Add `detachedUploads` map (§3.4)
  - Modify paste handler to use `startImageUpload` (§3.1) instead of plain text placeholder
  - Add sentinel re-paste detection in paste handler (§3.5)
  - Add `onUploadSuccess` and `onUploadFailure` handlers (§3.6)
  - Add CSS for `.cm-upload-spinner` (§3.2)

**What to test:**
- Paste image → spinner widget appears inline (styled pill with spinning icon, not raw text)
- Try to backspace into the spinner from the line below → cursor stops, nothing deleted
- Try to place cursor inside the spinner and type → nothing happens
- Select the spinner line with mouse, press Delete → spinner disappears (full deletion allowed)
- Cut the spinner (Ctrl+X), move cursor 5 lines down, paste (Ctrl+V) → spinner reappears at new position
- Delete the spinner, type some text, then undo twice → spinner reappears at original position
- Delete the spinner, never paste back, wait for upload → nothing inserted, no error
- Upload completes → spinner replaced with `![image-name](url)`, alt text is selected
- Upload fails → spinner removed, toast "Image upload failed." shown
- Paste two images quickly → two separate spinners, each resolves independently

### Phase 3: Smart Naming + Inline Rename

**Scope:** Polish the naming experience — auto-select alt text for easy rename, add right-click rename context menu.

**Files to create/modify:**
- `src/components/editor/TextEditor.vue` — add `contextmenu` handler in `domEventHandlers` for image rename detection (§6)

**What to test:**
- After upload completes, the default name (e.g., `image-1742123456-a3f1`) is selected in the editor — just start typing to rename
- Press Escape or click elsewhere → default name stays
- Right-click on `![name](url)` in editor → context menu appears with "Rename image"
- Click "Rename image" → alt text is selected, ready to overwrite
- Right-click on non-image text → no custom context menu, browser default appears

### Phase 4: Image Sizing + Centered Rendering

**Scope:** Parse `{w-500}` syntax in markdown, render all images centered with `<figure>` and optional captions.

**Files to create/modify:**
- `src/lib/markdown.ts` — add `walkTokens` hook for image size parsing, override image renderer to emit `<figure>` (§4)
- `src/components/editor/MarkdownPreview.vue` — add `:deep()` CSS for `.image-container`, `figcaption` (§5)

**Implementation notes:**
- First verify whether `marked` includes `{...}` in the image token's `raw` property. If not, a custom tokenizer extension is needed instead of `walkTokens`.
- The `parseSizeToCSS` function maps attribute strings to inline CSS.
- Default (no attribute) is `width: 100%`.

**What to test:**
- `![photo](url)` → centered, full-width image, no caption visible
- `![My photo](url)` → centered, full-width, "My photo" caption below in italic muted text
- `![photo](url){w-500}` → centered, exactly 500px wide
- `![photo](url){h-300}` → centered, 300px tall, width adjusts to maintain aspect ratio
- `![photo](url){w-1/2}` → centered, 50% of the preview pane width
- `![photo](url){w-auto}` → centered, natural image dimensions
- `![photo](url){w-full}` → same as no attribute, 100% width
- `![image-1742123456](url)` → centered, full-width, NO caption (default name detected and hidden)
- `![photo](url){w-500}{h-300}` → first attribute wins (500px wide), second ignored
- `![photo](url){garbage}` → unrecognized attribute, falls back to default (100% width)
- Resizing the preview pane → percentage-based images (`w-1/2`) adjust responsively

### Phase 5: Photos Tab (V2)

**Scope:** New sidebar tab showing all uploaded images, with drag-to-insert and Ctrl+click navigation.

**Files to create/modify:**
- `src/components/sidebar/PhotosTab.vue` — tree view of images by folder
- `src/stores/images.ts` — Pinia store: list images from storage, resolve folder paths, navigate-to-image action
- `src/components/sidebar/LilypadSidebar.vue` — add tab bar (Files | Photos), conditionally render `FileExplorer` or `PhotosTab`
- `src/components/editor/TextEditor.vue` — add Ctrl+click handler for image URL navigation (§9)

**What to test:**
- Photos tab shows all uploaded images grouped by their parent document's folder
- Images without a parent document appear under "Unsorted"
- Click a folder to expand/collapse (same UX as file explorer)
- Drag an image thumbnail from Photos Tab into the editor → markdown image link inserted at drop position
- Drag the same image into a different document → same URL, creating a hard link
- Ctrl+click (Cmd+click on Mac) an image link in the editor → sidebar switches to Photos tab, image is highlighted
- Right-click image in Photos Tab → "Rename" and "Delete" options
- "Rename" → inline input, same UX as file explorer rename
- "Delete" → confirm dialog → image removed from storage

### Phase 6: Reference Tracking + Garbage Collection

**Scope:** Database-backed reference counting, automatic cleanup of orphaned images after 7 days.

**Files to create/modify:**
- `supabase/migrations/YYYYMMDD_image_refs.sql` — create `image_refs` table with RLS (§11)
- `src/stores/images.ts` — reference scanning on document save, update `image_refs` rows
- `src/stores/files.ts` — modify `saveContent()` to trigger reference scan after saving
- `supabase/functions/image-cleanup/index.ts` — edge function for garbage collection (or client-side fallback)

**Implementation notes:**
- On every document save, scan the saved content for image URLs matching the storage pattern (`/user-files/{userId}/images/`). Compare against existing `image_refs` rows for this document. Insert new refs, delete stale ones.
- When deleting a ref, check if any other refs exist for the same `storage_path`. If not, set `unreferenced_at = now()`.
- The edge function runs daily: queries for `unreferenced_at < now() - 7 days`, batch-deletes storage files and rows.

**What to test:**
- Upload image in Note A → `image_refs` row created with `document_id = A`
- Drag same image into Note B → new `image_refs` row with `document_id = B`
- Remove the image link from Note A, save → that ref row deleted, but image still referenced by B → `unreferenced_at` stays null
- Remove from Note B too, save → last ref deleted → `unreferenced_at` set to now
- Image appears dimmed in Photos Tab with "Unused — deleted in 7 days" badge
- Drag it into Note C within 7 days → `unreferenced_at` reset to null, badge disappears
- Wait 7 days (or simulate by backdating `unreferenced_at`) → garbage collector deletes storage file and row
- Direct delete from Photos Tab → immediate removal, bypasses grace period
- Delete a document that contained images → `document_id` set to null via `ON DELETE SET NULL`, triggers unreferenced check
