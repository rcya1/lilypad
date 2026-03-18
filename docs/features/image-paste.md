# Feature: Image Paste & Image Management

## Overview

Paste or drag images into the markdown editor. Images upload to Supabase Storage in the background while an atomic, repositionable spinner widget shows progress inline. On completion the widget transforms into markdown image syntax using an entry reference (`![alt](img:{entryId})`) with sizing, centering, and caption support. Images are entries in the `entries` table — same as documents and folders — so they live in the folder tree and can be renamed, moved, and deleted with the same UX. The custom markdown renderer resolves `img:` references to full Supabase public URLs at render time. A future Photos Tab (V2) adds a filtered view for browsing images, with ghost text display names in the editor and hard-linking across notes.

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

  // Look for image items — handle ALL images in the paste, not just the first
  const imageFiles: File[] = []
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) imageFiles.push(file)
    }
  }

  if (imageFiles.length > 0) {
    event.preventDefault()
    for (const file of imageFiles) startImageUpload(view, file)
    return true
  }

  return false  // not an image paste — let CodeMirror handle normally
}
```

**Drop support (same pattern, not optional):** Listen for `drop` events, check `event.dataTransfer.files` for image types. Drag-from-desktop is at least as common as clipboard paste for power users — ship both in Phase 1.

**Guard:** If `editorStore.activeDocumentId` is null, return false immediately.

**Supported types:** Any `type.startsWith('image/')` — typically `image/png`, `image/jpeg`, `image/gif`, `image/webp`. We don't filter; Supabase Storage will reject unsupported types and we surface that as a toast.

### 2. Upload to Supabase Storage

**Where:** `src/stores/files.ts` — new action.

**Key design decision: images are entries.** An uploaded image is just another row in the `entries` table — `kind: 'document'`, `document_type: 'image'`, with a `storage_path` and `parent_id` like any other file. No separate `image_refs` table. Images live in the folder tree, can be renamed, moved, and deleted with the same UX as documents.

The markdown stores a reference using the entry's UUID — `img:{entryId}` — which the markdown renderer resolves to the full Supabase public URL at render time. A basic renderer override ships in Phase 1; Phase 4 replaces it with a full custom tokenizer extension (§4) that also handles sizing syntax.

The entry's `name` field serves as the human-readable display name. It's surfaced as ghost text next to the image reference in the editor (§6) and as the label in the file explorer / Photos Tab. Renaming is just `UPDATE entries SET name = $1` — same as renaming any file.

```ts
interface UploadedImage {
  entryId: string      // entries table UUID — used in markdown as img:{entryId}
  storagePath: string  // full storage path
  publicUrl: string    // resolved Supabase public URL
}

// Map of MIME subtypes that don't map cleanly to file extensions
const MIME_EXT_MAP: Record<string, string> = {
  'svg+xml': 'svg',
  'jpeg': 'jpg',
}

async function uploadImage(file: File, parentId: string | null): Promise<UploadedImage> {
  if (!auth.user) throw new Error('Not authenticated')

  const mimeSub = file.type.split('/')[1] ?? 'png'
  const ext = MIME_EXT_MAP[mimeSub] ?? mimeSub  // image/svg+xml → svg, image/png → png
  const entryId = crypto.randomUUID()
  const filename = `${entryId}.${ext}`
  const storagePath = `${auth.user.id}/${filename}`

  const { error } = await supabase.storage
    .from('user-files')  // reuse existing bucket
    .upload(storagePath, file, { contentType: file.type })

  if (error) throw error

  const { data: urlData } = supabase.storage
    .from('user-files')
    .getPublicUrl(storagePath)

  // Create an entry — same table as documents and folders.
  // The image lands in the same folder as the document being edited.
  // User can move it elsewhere via the file explorer.
  const defaultName = file.name || `image.${ext}`
  await supabase.from('entries').insert({
    id: entryId,
    user_id: auth.user.id,
    kind: 'document',
    document_type: 'image',
    name: defaultName,
    parent_id: parentId,
    storage_path: storagePath,
  })

  return {
    entryId,
    storagePath,
    publicUrl: urlData.publicUrl,
  }
}
```

**Storage path structure:** `{userId}/{entryId}.{ext}` — flat structure in the same `user-files` bucket used by PDFs. The entry UUID in the filename ensures uniqueness. (Note: `.md` files no longer use Storage — their content lives in the `entries.content` column. Images and PDFs are the only entry types with a `storage_path`.)

**Bucket:** Reuses `user-files` (already exists). No new bucket needed.

**No client-side size limit:** Rely on Supabase bucket policy. If the upload fails (too large, wrong type, network error), the error propagates to the caller which shows a toast and cleans up the sentinel.

**Default placement:** The image entry is created with `parent_id` set to the same folder as the document the user is currently editing. This way images naturally land next to their related notes. The user can move them anywhere via the file explorer.

**Default name:** Uses the original filename if available (e.g., `screenshot-2024.png` from a file drop), otherwise `image.{ext}`. The user can rename it like any other entry.

**Return value:** An `UploadedImage` object with the entry ID, storage path, and public URL. The files store should cache the `entryId → publicUrl` mapping immediately on upload so the preview can resolve `img:` references without a round-trip query to Supabase.

### 3. Atomic Upload Placeholder (CodeMirror Widget)

**Goal:** While the image uploads, show a spinner in the editor that behaves like a single atomic character. The user can delete it (backspace, delete, select+delete all work — they remove the entire sentinel as a unit), cut and re-paste it to reposition it, but cannot partially edit its contents.

There are four pieces that work together: a sentinel string in the document, a decoration that visually replaces it, a transaction filter that enforces atomic behavior, and a detached map that keeps the upload alive even when the sentinel is temporarily absent.

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

  // Start upload, placing the image in the same folder as the active document
  const activeDoc = editorStore.activeDocument!
  const parentId = activeDoc.parentId
  const promise = filesStore.uploadImage(file, parentId)
  detachedUploads.set(uuid, { promise })

  // Handle completion.
  // If the user switches document tabs during upload, this view may be
  // destroyed. The handlers check view.dom.parentNode before dispatching.
  // If the view is gone, the result is stored in completedUploads so it
  // can be resolved when the user switches back (see §3.7).
  promise
    .then((result) => onUploadSuccess(view, uuid, result))
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

#### 3.3. Transaction filter (atomic character behavior)

The spinner should behave like a single character: any edit that touches it deletes the whole thing. A `transactionFilter` inspects every transaction before it's applied. If a change partially overlaps a sentinel range, the filter **expands** that change to cover the entire sentinel (+ trailing newline). This means backspace, delete, and partial selections all cleanly remove the sentinel as a unit rather than silently doing nothing.

```ts
const sentinelGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr

  const doc = tr.startState.doc.toString()
  const sentinels: { from: number; to: number }[] = []
  sentinelPattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = sentinelPattern.exec(doc)) !== null) {
    // Include trailing newline in the atomic range if present
    const end = m.index + m[0].length
    const hasTrailingNewline = end < doc.length && doc[end] === '\n'
    sentinels.push({ from: m.index, to: hasTrailingNewline ? end + 1 : end })
  }

  if (sentinels.length === 0) return tr

  // Check each change — if it partially overlaps a sentinel, expand it
  let needsExpansion = false
  const expandedChanges: { from: number; to: number; insert: string }[] = []

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    let from = fromA
    let to = toA
    for (const s of sentinels) {
      const overlaps = from < s.to && to > s.from
      if (overlaps) {
        // Expand to cover the full sentinel
        from = Math.min(from, s.from)
        to = Math.max(to, s.to)
        needsExpansion = true
      }
    }
    expandedChanges.push({ from, to, insert: inserted.toString() })
  })

  if (!needsExpansion) return tr

  // Rebuild the transaction with expanded changes
  return [{
    changes: expandedChanges,
    // Don't preserve selection — it may point into the deleted range
  }]
})
```

**What this means for the user:**
- Backspacing from just after the spinner → the entire spinner is deleted (atomic delete).
- Pressing Delete from just before the spinner → the entire spinner is deleted.
- Selecting part of the spinner and pressing Delete → the entire spinner is deleted.
- Selecting the entire spinner line and pressing Delete or Ctrl+X → works as expected (full deletion).
- Normal typing before or after the spinner → allowed (no overlap).

The key insight: the spinner is never "stuck." Any attempt to edit it removes it entirely, which is the intuitive behavior — the user sees one visual object and can delete it in one action.

#### 3.4. Detached uploads map

A module-level map tracks all in-flight uploads by UUID, independent of whether the sentinel is in the document:

```ts
// Module-level in TextEditor.vue
const detachedUploads = new Map<string, {
  promise: Promise<UploadedImage>
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

**If never re-pasted:** The upload completes, `onUploadSuccess` searches the document, finds nothing, and silently discards. The image entry still exists in the `entries` table — the user can find it in the file explorer or Photos Tab and either drag it into a document or delete it.

#### 3.6. Upload completion handlers

```ts
function onUploadSuccess(view: EditorView, uuid: string, result: UploadedImage) {
  detachedUploads.delete(uuid)

  // If the view was destroyed (user switched tabs), stash the result.
  // When the document is reopened, §3.7 resolves any stashed uploads.
  if (!view.dom.parentNode) {
    completedUploads.set(uuid, result)
    return
  }

  const sentinel = `<!--uploading:${uuid}-->`
  const doc = view.state.doc.toString()
  const idx = doc.indexOf(sentinel)

  if (idx === -1) return  // sentinel gone — silently discard

  // Insert an image reference using the entry UUID. The markdown renderer
  // resolves "img:{entryId}" to the full Supabase public URL at render time.
  const markdown = `![](img:${result.entryId})`

  // Always replace silently — do NOT move the cursor or select text.
  // The user may have moved on to typing something else. No layout shift.
  const sentinelEnd = idx + sentinel.length
  const hasTrailingNewline = sentinelEnd < doc.length && doc[sentinelEnd] === '\n'
  view.dispatch({
    changes: {
      from: idx,
      to: hasTrailingNewline ? sentinelEnd + 1 : sentinelEnd,
      insert: markdown + '\n',
    },
  })
}

function onUploadFailure(view: EditorView, uuid: string) {
  detachedUploads.delete(uuid)

  // If the view was destroyed, stash the failure so §3.7 can clean up the sentinel.
  if (!view.dom.parentNode) {
    failedUploads.add(uuid)
    return
  }

  const sentinel = `<!--uploading:${uuid}-->`
  const doc = view.state.doc.toString()
  const idx = doc.indexOf(sentinel)

  if (idx !== -1) {
    const sentinelEnd = idx + sentinel.length
    const hasTrailingNewline = sentinelEnd < doc.length && doc[sentinelEnd] === '\n'
    view.dispatch({
      changes: { from: idx, to: hasTrailingNewline ? sentinelEnd + 1 : sentinelEnd, insert: '' },
    })
  }

  useToastStore().addToast('Image upload failed.', 'error')
}
```

**Insertion behavior:** The sentinel is always replaced silently. The user's cursor position and selection are untouched — no scroll, no jump, no layout shift. They may not even notice the upload finished, which is the correct UX if they've moved on to other editing.

**Alt text:** Inserted as empty (`![]`) by default. The user fills it in manually if they want a caption.

#### 3.7. Resolving uploads on document reopen

If an upload completes (or fails) while the user is on a different tab, the result is stashed in module-level maps:

```ts
// Module-level alongside detachedUploads
const completedUploads = new Map<string, UploadedImage>()
const failedUploads = new Set<string>()
```

When a CodeMirror view is created (document tab opened/switched to), scan the document for any sentinels and check both maps:

```ts
function resolveStashedUploads(view: EditorView) {
  const doc = view.state.doc.toString()
  sentinelPattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = sentinelPattern.exec(doc)) !== null) {
    const uuid = m[0].match(/[a-f0-9-]+/)?.[0]  // extract UUID from sentinel
    if (!uuid) continue

    if (completedUploads.has(uuid)) {
      const result = completedUploads.get(uuid)!
      completedUploads.delete(uuid)
      onUploadSuccess(view, uuid, result)  // view is fresh and attached
      return  // doc changed — re-scan would need new toString()
    }

    if (failedUploads.has(uuid)) {
      failedUploads.delete(uuid)
      onUploadFailure(view, uuid)
      return
    }
  }
}
```

Call `resolveStashedUploads(view)` once when the editor mounts or when the user switches back to a document tab. This way, no upload result is ever lost — the sentinel stays in the document until the view is available to replace it.

### 4. Image Sizing Syntax

**Where:** `src/lib/markdown.ts` — custom tokenizer extension + image renderer.

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

#### Implementation: custom tokenizer extension + renderer override + image resolver

The `{...}` syntax is not standard markdown — `marked` won't include it in the image token. A `walkTokens` approach won't work because `marked` stops parsing the image at the closing `)`. Instead, use a **custom tokenizer extension** that matches the full `![alt](url){attr}` pattern as a single token.

The image renderer also needs to resolve `img:{entryId}` references to actual Supabase public URLs. This is done via an **image resolver** — a function passed into `parseMarkdown()`:

```ts
// parseMarkdown signature changes to accept an optional resolver:
// export function parseMarkdown(
//   content: string,
//   imageResolver?: (imageId: string) => string | null
// ): string
//
// The caller (MarkdownPreview.vue) provides the resolver from the files store:
// parseMarkdown(content, (entryId) => filesStore.getImageUrl(entryId))

// Custom inline tokenizer that captures the optional {attr} after an image
const imageSizeExtension: marked.TokenizerAndRendererExtension = {
  name: 'sizedImage',
  level: 'inline',
  start(src) { return src.indexOf('![') },
  tokenizer(src) {
    // Match: ![alt](url){attr} or ![alt](url) — greedy on the {attr} part
    const match = src.match(/^!\[([^\]]*)\]\(([^)]+)\)(?:\{(w-[^}]+|h-[^}]+)\})?/)
    if (match) {
      return {
        type: 'sizedImage',
        raw: match[0],
        alt: match[1],
        href: match[2],
        sizeAttr: match[3] ?? null,  // e.g. 'w-500' or null
      }
    }
  },
  renderer(token) {
    const style = parseSizeToCSS(token.sizeAttr)

    // Resolve image source:
    // - "img:{entryId}" → look up public URL via imageResolver
    // - Regular URL → use as-is
    let src = token.href
    const imgMatch = token.href.match(/^img:([a-f0-9-]+)$/)
    if (imgMatch && imageResolver) {
      const resolved = imageResolver(imgMatch[1])  // look up by entry UUID
      if (resolved) src = resolved
    }

    // Caption: use alt text if provided and non-empty
    const caption = (token.alt as string)?.trim() || ''

    const imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" style="${style}" />`
    const captionTag = caption
      ? `<figcaption>${escapeHtml(caption)}</figcaption>`
      : ''

    return `<figure class="image-container">${imgTag}${captionTag}</figure>`
  },
}

// Register via marked.use({ extensions: [imageSizeExtension] })

function parseSizeToCSS(attr: string | null): string {
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

**Why a custom tokenizer instead of `walkTokens`:** `marked` parses `![alt](url)` and stops at the `)`. The `{...}` becomes a separate text token. A `walkTokens` hook cannot look ahead to the next sibling token to merge them. A custom tokenizer extension matches the full pattern in one pass, which is reliable and clean.

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
- Alt text is used as the caption: `![This is my photo](img:a3f19bc2-1234-5678-abcd-ef0123456789)` → caption "This is my photo".
- Empty alt text (`![](img:a3f19bc2-1234-5678-abcd-ef0123456789)`) → no `<figcaption>` emitted.
- The `<figure>` is always centered (`margin: auto`), regardless of the image width.

### 6. Ghost Text Display Names in the Editor

**Goal:** The markdown stores an entry UUID reference (`img:a3f19bc2-...`) which is functional but not human-readable. To help the user identify images at a glance, show the entry's **name** as ghost text (grayed, non-editable) after the image reference.

```
What the document contains:  ![caption](img:a3f19bc2-1234-5678-abcd-ef0123456789)
What the user sees:          ![caption](img:a3f19bc2-...) class-diagram.png
                                                          ^^^^^^^^^^^^^^^^^ ghost text (muted, italic)
```

The ghost text is purely decorative — it's not in the document, can't be selected or copied, and updates automatically when the entry is renamed.

**Implementation — Widget Decoration:**

A `StateField<DecorationSet>` scans the document for `img:` references and creates a `Decoration.widget` after each one. The widget renders a small inline label showing the entry name.

```ts
const imgRefPattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g

const imgGhostNameField = StateField.define<DecorationSet>({
  create(state) { return buildGhostDecorations(state) },
  update(decos, tr) {
    if (tr.docChanged) return buildGhostDecorations(tr.state)
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

function buildGhostDecorations(state: EditorState): DecorationSet {
  const builder: Range<Decoration>[] = []
  const doc = state.doc.toString()
  imgRefPattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = imgRefPattern.exec(doc)) !== null) {
    const entryId = match[1]
    const entry = filesStore.getEntry(entryId)
    if (entry) {
      // Place widget after the full image reference (including optional {attr})
      const pos = match.index + match[0].length
      builder.push(
        Decoration.widget({
          widget: new GhostNameWidget(entry.name),
          side: 1,  // after the position
        }).range(pos)
      )
    }
  }
  return Decoration.set(builder, true)
}

class GhostNameWidget extends WidgetType {
  constructor(private name: string) { super() }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-image-ghost-name'
    span.textContent = ` ${this.name}`
    return span
  }

  eq(other: GhostNameWidget) { return this.name === other.name }
  ignoreEvent() { return true }
}
```

**CSS:**

```css
.cm-image-ghost-name {
  color: var(--text-muted);
  font-style: italic;
  font-size: 0.85em;
  pointer-events: none;
  user-select: none;
}
```

**When to show ghost text:** Always, for any `img:` reference where the entry exists. The entry always has a human-readable `name` (set from the original filename on upload), so there's always something useful to show.

**Interaction with sizing syntax:** If the image has a `{...}` attribute, the ghost text must appear _after_ the attribute, not between `)` and `{`. The regex accounts for the optional `{...}` suffix and places the widget at the end of the full match.

**Performance:** `buildGhostDecorations` calls `state.doc.toString()` and runs a regex on every doc change. For a notes app where documents are typically <50KB, this is negligible. If it ever matters, switch to incremental scanning via `syntaxTree` or `RangeSet.map`.

### 7. Right-Click Rename (Display Name)

**Where:** `src/components/editor/TextEditor.vue` — context menu handler.

**What "rename" means here:** Renaming updates the `name` column in the `entries` table — same operation as renaming any file in the file explorer. The document text (`img:{entryId}`) is **never modified** — the UUID reference is permanent. The ghost text decoration (§6) updates reactively to reflect the new name.

The alt text (`![caption]`) is separate and always freely editable by the user — just click into the brackets and type. No special handling needed for that.

**Detection:** On `contextmenu` event, check if the click position falls within a Lilypad image reference. Scan the line for the pattern `!\[...\](img:...)`:

```ts
contextmenu(event: MouseEvent, view: EditorView) {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos === null) return false

  const line = view.state.doc.lineAt(pos)
  const lineText = line.text
  // Capture groups: [1] = alt text, [2] = entryId
  const imagePattern = /!\[([^\]]*)\]\(img:([a-f0-9-]+)\)/g
  let match: RegExpExecArray | null
  while ((match = imagePattern.exec(lineText)) !== null) {
    const absFrom = line.from + match.index
    const absTo = absFrom + match[0].length
    if (pos >= absFrom && pos <= absTo) {
      event.preventDefault()
      const entryId = match[2]
      showImageContextMenu(event, view, { entryId })
      return true
    }
  }
  return false
}
```

**Context menu UI:** A small floating div (same style as the file explorer context menu) with one option: "Rename image." On click, open a small inline input (or popover) pre-filled with the current entry name. On submit:

```ts
await filesStore.renameEntry(entryId, newName)
// The ghost text decoration updates reactively — no document changes needed
```

This is the same `renameEntry` action used by the file explorer — no special image-specific code needed. The ghost text decoration re-renders automatically because the files store is reactive.

**The user can also rename from the file explorer or Photos Tab** — same operation, same result.

---

## V2 — Photos Tab

A dedicated sidebar tab for browsing and managing all uploaded images.

### 8. Photos Tab UI

**Where:**
- `src/components/sidebar/PhotosTab.vue` — new tab component
- `src/stores/files.ts` — add computed getters to filter image entries from the existing entries tree

**Tab switching:** `LilypadSidebar.vue` gets a tab bar at the top of the sidebar with two tabs: "Files" (current file explorer) and "Photos" (new). Only one is visible at a time. The tab bar is a simple row of two buttons; the active tab has an accent underline (same pattern as editor tabs).

**Layout:** The Photos Tab is a filtered view of the existing file explorer tree — it shows the same folder structure, but only folders that contain image entries, and the leaf nodes are images instead of documents. Since images are entries, the folder hierarchy is the real one — not a synthetic grouping.

```
Photos
├── Lecture Notes/
│   ├── screenshot-2024-03-15.png
│   └── class-diagram.jpg
├── Homework/
│   └── proof-sketch.png
└── (root)
    └── image.webp
```

- Each image shows a small thumbnail (lazy-loaded, ~40px) and the entry name.
- Folder structure is the real folder structure — images live in the `entries` tree just like documents. No virtual folders or synthetic grouping.
- Root-level images appear at the top level of the Photos Tab, same as root-level documents in the file explorer.

**Data source:** The Photos Tab is a computed filter over the existing `filesStore.entries` — filter for `document_type === 'image'`, preserving parent folder structure. Thumbnails are loaded lazily via `supabase.storage.from('user-files').getPublicUrl(storagePath)`.

### 9. Hard Links — Drag Image into Editor

Dragging an image thumbnail from the Photos Tab into the CodeMirror editor inserts a markdown image link.

**Implementation:**
- The thumbnail element has `draggable="true"`.
- `dragstart` sets `event.dataTransfer` with `text/plain` data containing the markdown: `![](img:{entryId})`.
- CodeMirror's default drop handler inserts the text at the drop position. No conflict with the §1 drop handler — that handler checks `dataTransfer.files` for binary image files (desktop drag), while this is a text-only drag with no files attached.
- This means the same `img:{entryId}` reference now appears in multiple documents — a "hard link." The image exists once in storage.

### 10. Ctrl+Click Navigation

**Where:** `src/components/editor/TextEditor.vue` — click handler.

In the editor, Ctrl+clicking (Cmd+click on Mac) on an image link navigates to that image in the Photos Tab.

**Detection:** On `click` event, check for `event.ctrlKey || event.metaKey`. If true, check if the click position falls within an `img:{entryId}` reference (same pattern matching as §7). Extract the entry ID, then:

```ts
// Switch to Photos Tab and highlight the image
uiStore.navigateToEntry(entryId, 'photos')
```

The `navigateToEntry` action:
1. Sets the active sidebar tab to "Photos".
2. Finds the entry in the tree.
3. Expands the parent folder if collapsed.
4. Scrolls to and visually highlights the image (e.g., a brief accent background flash).

### 11. Image Renaming (Photos Tab)

Same mechanism as the editor right-click rename (§7) — a single DB update to `entries.name`. Ghost text and Photos Tab label update reactively.

**From Photos Tab:** Right-click an image → "Rename" → inline input shows the current name (same UX as file explorer's `isRenaming` pattern in `FileExplorerNode.vue`). On submit:

```ts
await filesStore.renameEntry(entryId, newName)
```

This is the exact same rename operation used everywhere — file explorer, editor right-click, Photos Tab. One code path, one store action.

### 12. Schema Changes & Deletion

#### Database schema changes

No new tables. Images use the existing `entries` table. The only schema change is adding `'image'` to the `document_type` check constraint (if one exists) and ensuring the `storage_path` column is populated for image entries.

The `entries` row for an image looks like:

```
id:             uuid (PK)
user_id:        uuid (FK → auth.users)
kind:           'document'
document_type:  'image'
name:           'screenshot-2024-03-15.png'  (original filename, user can rename)
parent_id:      uuid | null                  (folder — same as any other entry)
storage_path:   '{userId}/{entryId}.png'     (binary file in Storage)
content:        null                         (.md files use this; images don't)
sort_order:     int
created_at:     timestamptz
updated_at:     timestamptz
```

Compare with a `.md` entry: `storage_path` is null, `content` holds the markdown text. Images are the inverse — `storage_path` points to the binary file, `content` is null.

On the TypeScript side, `DocumentType` in `src/types/file-explorer.ts` gains `'image'`:

```ts
export type DocumentType = 'pdf' | 'md' | 'image'
```

**Entry lifecycle:**
1. **Created** when an image is uploaded (`uploadImage` in §2 inserts the entry with `kind: 'document'`, `document_type: 'image'`).
2. **Renamed** via file explorer, Photos Tab, or editor right-click — updates `entries.name`.
3. **Moved** by dragging in the file explorer — updates `entries.parent_id`. Images behave like any other entry.
4. **Deleted** from the file explorer or Photos Tab — storage file and entry row removed.

#### Deletion

Right-click → "Delete" → confirm dialog → immediately:
1. Delete the storage file from Supabase Storage.
2. Delete the `entries` row.
3. Any notes still referencing `img:{entryId}` show a broken/missing image placeholder in the preview. This is intentional — the user explicitly chose to delete.

This uses `filesStore.deleteEntry(entryId)`, which already handles Storage cleanup for entries that have a `storage_path` (images, PDFs). For `.md` files, `deleteEntry` just removes the row (no Storage file exists).

**No automatic garbage collection.** Images persist until the user manually deletes them. Storage costs for personal note images are trivial, and a manual delete is simple and predictable.

---

## User Flows — All Ways to Insert an Image

A summary of every way a user can get an image into a document, which phase it ships in, and what happens under the hood.

### Flow 1: Paste from Clipboard (V1 — Phase 1/2)

**Trigger:** User copies a screenshot, snipping tool capture, or image from another app, then presses Ctrl+V / Cmd+V in the editor.

**Steps:**
1. User takes a screenshot or copies an image.
2. User focuses the editor and presses Ctrl+V.
3. A spinner widget appears at the cursor (Phase 2; Phase 1 uses a simple text placeholder).
4. The image uploads to Supabase Storage in the background.
5. On success: spinner is silently replaced with `![](img:a3f19bc2-1234-5678-abcd-ef0123456789)`. No cursor movement, no selection, no layout shift.
6. On failure: spinner is removed, toast "Image upload failed."
7. The user optionally adds alt text for a caption and/or renames the image via right-click or Photos Tab.

**Result:** `![caption](img:{entryId})` — uploaded to Lilypad storage, visible in file explorer and Photos Tab. Entry name shown as ghost text.

### Flow 2: Drag File from Desktop (V1 — Phase 1/2)

**Trigger:** User drags an image file from their OS file explorer / desktop onto the editor.

**Steps:**
1. User drags `diagram.png` from their desktop into the editor.
2. The drop handler intercepts the `drop` event, checks `dataTransfer.files` for image types.
3. Same flow as clipboard paste from step 3 onward — spinner, upload, replace.

**Result:** Same as Flow 1. `![](img:{entryId})`.

### Flow 3: Drag from Photos Tab (V2 — Phase 5)

**Trigger:** User wants to reference an already-uploaded image in a different document.

**Steps:**
1. User opens the Photos Tab in the sidebar.
2. User finds the image they want (browsing folders, or seeing it from a previous upload).
3. User drags the image thumbnail from the Photos Tab into the editor.
4. A markdown image link is inserted at the drop position immediately — no upload needed, the image already exists in storage.

**Result:** `![](img:{entryId})` — same entry ID as the original, creating a hard link. The image now appears in both documents.

### Flow 4: Paste an Image URL (No special handling)

**Trigger:** User copies an image URL from a browser and pastes into the editor.

**Behavior:** The URL is pasted as plain text. The paste handler only intercepts binary image data from the clipboard, not text that happens to look like a URL. If the user wants it rendered as an image, they wrap it in `![](url)` themselves.

**Result:** `![](https://example.com/photo.jpg)` — external URL, not uploaded to Lilypad.

### Flow 5: Upload via File Picker (Future)

**Trigger:** User wants to upload a local image but doesn't want to drag-and-drop.

**Steps:**
1. User clicks an "Insert image" button in the editor toolbar (or uses a keyboard shortcut / command palette).
2. A native file picker dialog opens, filtered to image types.
3. User selects one or more images.
4. Each image follows the same upload flow as clipboard paste (Flow 1, steps 3–7).

**Result:** `![](img:{entryId})` — uploaded to Lilypad, same as Flow 1.

### Flow 6: Download External Image to Lilypad (Future)

**Trigger:** User has an external image link in their document and wants to make it permanent by uploading it to Lilypad storage.

**Steps:**
1. User right-clicks on an existing external image link (`![alt](https://...)`).
2. Context menu shows "Upload to Lilypad."
3. Lilypad downloads the image from the URL, uploads it to Supabase Storage, and creates an entry in the `entries` table.
4. The external URL in the markdown is replaced with an `img:{entryId}` reference.

**Result:** `![alt](img:{entryId})` — converted from external dependency to Lilypad-managed image.

### Flow Summary

| Flow | Trigger | Phase | Result type | Upload? |
|------|---------|-------|-------------|---------|
| 1. Clipboard paste | Ctrl+V with image | V1 Phase 1/2 | `img:{entryId}` | Yes |
| 2. File drag-and-drop | Drag from OS | V1 Phase 1/2 | `img:{entryId}` | Yes |
| 3. Photos Tab drag | Drag from sidebar | V2 Phase 5 | `img:{entryId}` | No (already uploaded) |
| 4. URL paste | Ctrl+V with URL | Future | External URL | No (plain text) |
| 5. File picker upload | Toolbar button | Future | `img:{entryId}` | Yes |
| 6. Download to Lilypad | Right-click convert | Future | `img:{entryId}` | Yes (downloads first) |

### External Image Compatibility

Standard markdown images with regular URLs (`![alt](https://example.com/photo.jpg)`) already render correctly — the image renderer passes through any URL that doesn't start with `img:`. The ghost text decoration (§6) only targets `img:` references, so external URLs are untouched in the editor.

All flows produce one of two reference types:
- **`![alt](img:{entryId})`** — Lilypad-managed, lives in the entries tree, shows in Photos Tab, deletable by user
- **`![alt](https://...)`** — External, rendered as-is, not tracked or managed by Lilypad

Both types support the same sizing syntax (`{w-500}`, `{h-300}`, etc.) and centered rendering with captions.

---

## Implementation Phases

Each phase is independently shippable and testable. Phases build on each other sequentially.

### Phase 1: Basic Paste + Upload

**Scope:** Paste or drag an image, upload it, insert markdown. Simple text placeholder (`![Uploading…]()`) while uploading — no widget system yet. Both paste and drop handlers ship together. Also adds `'image'` to `DocumentType` and extends the files store with image upload/resolve capabilities.

**Files to create/modify:**
- `src/types/file-explorer.ts` — add `'image'` to `DocumentType`
- `src/stores/files.ts` — add `uploadImage(file, parentId)` action (§2), add `getImageUrl(entryId)` getter that resolves an image entry's `storage_path` to a Supabase public URL
- `src/lib/markdown.ts` — add basic `img:` URL resolution in the image renderer (override `renderer.image` to resolve `img:{entryId}` → public URL via the image resolver callback). No sizing or `<figure>` wrapping yet — that's Phase 4.
- `src/components/editor/TextEditor.vue` — add `paste` and `drop` handlers in `domEventHandlers`, insert placeholder text, replace on completion
- `src/components/editor/MarkdownPreview.vue` — pass `imageResolver` to `parseMarkdown()`

**Implementation notes:**
- Use a simple text placeholder: `![Uploading image…]()` with a random suffix for uniqueness.
- On success: search the document for the placeholder string and replace it with `![](img:{entryId})`.
- On failure: search and remove the placeholder, show toast.
- Handle multiple images in a single paste/drop — each gets its own placeholder and upload.
- This is intentionally simple — Phase 2 replaces the placeholder mechanism entirely.

**What to test:**
- Paste a screenshot → placeholder appears immediately → `![](img:{entryId})` appears after upload → image visible in preview (renderer resolves `img:` to Supabase URL)
- Drag an image from the desktop → same flow as paste
- Paste text / code → normal paste behavior, no interference
- Paste while no document is open → nothing happens
- Upload failure (e.g., disconnect wifi) → placeholder removed, toast error shown
- Paste two images rapidly → both get unique placeholders, both upload and insert correctly
- Drag multiple files at once → all get placeholders and upload independently
- Paste a very large image → Supabase rejects it, toast error, placeholder cleaned up

### Phase 2: Atomic Widget Placeholder

**Scope:** Replace the simple text placeholder from Phase 1 with the full sentinel + decoration + transaction filter system described in §3.

**Files to create/modify:**
- `src/components/editor/TextEditor.vue`:
  - Add `uploadWidgetField` StateField (§3.2) to the extensions array
  - Add `sentinelGuard` transactionFilter (§3.3) to the extensions array — enforces atomic character behavior
  - Add `UploadSpinnerWidget` class (§3.2)
  - Add `detachedUploads` map (§3.4)
  - Modify paste/drop handlers to use `startImageUpload` (§3.1) instead of plain text placeholder
  - Add sentinel re-paste detection in paste handler (§3.5)
  - Add `onUploadSuccess` and `onUploadFailure` handlers (§3.6)
  - Add `completedUploads`/`failedUploads` maps and `resolveStashedUploads` (§3.7)
  - Add CSS for `.cm-upload-spinner` (§3.2)

**What to test:**
- Paste image → spinner widget appears inline (styled pill with spinning icon, not raw text)
- Backspace from just after the spinner → entire spinner is deleted (atomic behavior)
- Press Delete from just before the spinner → entire spinner is deleted
- Select part of the spinner and press Delete → entire spinner is deleted
- Cut the spinner (Ctrl+X), move cursor 5 lines down, paste (Ctrl+V) → spinner reappears at new position
- Delete the spinner, type some text, then undo twice → spinner reappears at original position
- Delete the spinner, never paste back, wait for upload → nothing inserted, no error
- Upload completes → spinner silently replaced with `![](img:{entryId})`, cursor unmoved
- Upload fails → spinner removed, toast "Image upload failed." shown
- Paste two images quickly → two separate spinners, each resolves independently
- Paste image, switch to a different document tab, wait for upload, switch back → spinner is replaced with the image reference on return

### Phase 3: Ghost Text Display Names + Right-Click Rename

**Scope:** Add ghost text decorations showing human-readable display names next to `img:` references. Add right-click "Rename image" context menu that opens a rename input and updates the DB.

**Files to create/modify:**
- `src/components/editor/TextEditor.vue` — add `imgGhostNameField` StateField (§6), add `contextmenu` handler in `domEventHandlers` for image rename detection (§7), add CSS for `.cm-image-ghost-name`
- `src/stores/files.ts` — add `getEntry(entryId)` getter if not already present, `renameEntry(entryId, newName)` action

**What to test:**
- `![](img:{entryId})` → ghost text shows the entry's `name` (e.g., "screenshot.png") in muted italic
- Rename the entry → ghost text updates reactively
- Ghost text cannot be selected, copied, or edited — it's purely decorative
- Right-click on `![alt](img:{entryId})` → context menu with "Rename image"
- Click "Rename image" → inline input/popover appears with current entry name
- Type a new name, submit → `entries.name` updated, ghost text updates reactively
- Right-click on non-image text → no custom context menu, browser default appears

### Phase 4: Image Sizing + Centered Rendering

**Scope:** Add `{w-500}` sizing syntax and upgrade all images to centered `<figure>` rendering with optional captions. Replaces the basic image renderer from Phase 1 with the full custom tokenizer extension.

**Files to create/modify:**
- `src/lib/markdown.ts` — replace the basic image renderer override (Phase 1) with the custom `sizedImage` tokenizer extension (§4). The extension handles both `img:` resolution and `{...}` sizing in one pass.
- `src/components/editor/MarkdownPreview.vue` — add `:deep()` CSS for `.image-container`, `figcaption` (§5)

**Implementation notes:**
- Use a custom `marked` tokenizer extension (not `walkTokens`) that matches the full `![alt](url){attr}` pattern as a single token. This is necessary because `marked` stops parsing the image at `)` and won't include `{...}` in the image token's `raw`.
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
- `![photo](url){w-500}{h-300}` → only first `{...}` is captured by the tokenizer, second is literal text
- `![photo](url){garbage}` → tokenizer only captures `w-*`/`h-*` patterns, so `{garbage}` is not matched — image renders at default (100% width), `{garbage}` appears as literal text
- Resizing the preview pane → percentage-based images (`w-1/2`) adjust responsively

### Phase 5: Photos Tab (V2)

**Scope:** New sidebar tab showing all uploaded images, with drag-to-insert and Ctrl+click navigation.

**Files to create/modify:**
- `src/components/sidebar/PhotosTab.vue` — filtered tree view showing only folders containing images, with image entries as leaf nodes
- `src/stores/files.ts` — add computed getter to filter the entries tree for image entries, add `navigateToEntry(entryId, tab)` action
- `src/components/sidebar/LilypadSidebar.vue` — add tab bar (Files | Photos), conditionally render `FileExplorer` or `PhotosTab`
- `src/components/editor/TextEditor.vue` — add Ctrl+click handler for image navigation (§10)

**What to test:**
- Photos tab shows all uploaded images in their real folder structure
- Root-level images appear at the top level, same as in the file explorer
- Click a folder to expand/collapse (same UX as file explorer)
- Drag an image thumbnail from Photos Tab into the editor → markdown image link inserted at drop position
- Drag the same image into a different document → same `img:{entryId}` reference, creating a hard link
- Ctrl+click (Cmd+click on Mac) an image link in the editor → sidebar switches to Photos tab, image is highlighted
- Right-click image in Photos Tab → "Rename" and "Delete" options
- "Rename" → inline input, same UX as file explorer rename
- "Delete" → confirm dialog → storage file and entry deleted immediately
- Notes referencing a deleted image show a broken/missing image placeholder in preview
- RLS: user A cannot see or modify user B's images
