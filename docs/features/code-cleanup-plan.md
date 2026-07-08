# Code Cleanup & Hardening Plan

This document is a complete, ordered work plan for cleaning up the Lilypad codebase. It was
produced by a full-codebase audit (2026-07-07). It is written so that an agent **without any
other context** can execute it task by task.

---

## How to use this document (rules for the executing agent)

1. **Do the tasks in order.** Phases build on each other: Phase 0 creates the test safety net
   that later phases rely on. Within a phase, tasks are independent unless stated otherwise.
2. **One task = one commit.** Use the commit message given in each task.
3. **After every task, run the verification commands** listed in the task. If any fail, fix the
   failure before committing. Never commit with a failing type-check or test.
4. **Line numbers drift.** Every task gives a search anchor (a unique string to find). If a line
   number and anchor disagree, trust the anchor. If you cannot find the anchor, STOP and
   re-read the surrounding file — do not guess.
5. **Do not refactor beyond the task.** No drive-by renames, no reformatting untouched code,
   no changing behavior unless the task says so.
6. **Code style:** no semicolons, single quotes, 100-char lines (Prettier config). `@` maps to
   `./src`. Comments explain *why*, not *what*.
7. **Vue template rule:** never write multi-statement arrow functions inside templates —
   Prettier can mangle them into code that only `yarn build` catches. Always use a named
   method in `<script setup>`.
8. **Run yarn via the Bash tool** (it is allowlisted), not PowerShell.

### Verification commands

```bash
yarn type-check   # vue-tsc — must pass after every task
yarn test         # vitest — must pass after every task
yarn build        # run at the end of every phase (type-check + vite build)
```

---

## Phase 0 — Test safety net

Everything after this phase is refactoring; these tests are what makes the refactoring safe.

### Task 0.1 — Tests for the trigram library

**File to create:** `src/lib/trigram.test.ts`

`src/lib/trigram.ts` is pure (no imports besides types) and currently untested. Write a vitest
suite modeled on the style of `src/lib/markdown.test.ts`. Cover at minimum:

- `extractTrigrams`: returns all 3-char substrings lowercased; returns empty set for strings
  shorter than 3 chars; deduplicates repeated trigrams.
- `buildTrigramIndex`: given a `Map<string,string>` of two files sharing a trigram, the index
  maps that trigram to both file IDs.
- `removeFileFromIndex`: file ID disappears from all sets; trigram keys whose set becomes
  empty are deleted from the map.
- `updateTrigramsForFile`: old trigrams for the file are removed, new ones added.
- `findLiteralCandidates`: returns `null` for queries under 3 chars; returns the intersection
  of file sets for multi-trigram queries; returns an empty set when any trigram is missing
  from the index.
- `extractLiteralRuns`: `'foobar'` → `['foobar']`; `'foo.*bar'` → `['foo', 'bar']` — wait,
  runs must be **≥ 3 chars**, so `'foo.*bar'` → `['foo', 'bar']` (both are exactly 3);
  `'ab.*cd'` → `[]`; escaped metachars count as literals (`'foo\\.bar'` → `['foo.bar']`);
  character classes break runs (`'abc[xyz]def'` → `['abc', 'def']`).
- `splitOnTopLevelPipe`: `'abc|def'` → `['abc','def']`; `'a(b|c)d'` → `['a(b|c)d']` (pipe
  inside group is not split); escaped pipe `'a\\|b'` is not split.
- `findRegexCandidates`: returns `null` when a branch has no literal runs (full scan);
  returns the union across alternation branches.

**Verify:** `yarn test` — all new tests pass. **Commit:** `test: add trigram library tests`

### Task 0.2 — Tests for the editor store

**File to create:** `src/stores/editor.test.ts`

The editor store (`src/stores/editor.ts`) holds the most intricate state logic in the app
(tabs, preview tabs, dirty tracking, debounced auto-save). Test it with a fresh Pinia per test
and mocked dependencies:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// The editor store imports these stores inside saveDocument; mock them at module level.
const uploadContent = vi.fn(async () => true)
vi.mock('@/stores/files', () => ({
  useFilesStore: () => ({ uploadContent }),
}))
const addToast = vi.fn()
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ addToast }),
}))

import { useEditorStore } from './editor'

beforeEach(() => {
  setActivePinia(createPinia())
  uploadContent.mockClear()
  addToast.mockClear()
})
```

Cover at minimum:

- `openDocument`: adds to `openDocuments` and `tabOrder`, sets active; opening an
  already-open id activates it without duplicating the tab.
- Preview semantics: `openDocumentAsPreview` sets `previewDocumentId`; opening a second
  preview replaces the first **in the same tab slot** (assert `tabOrder`); a document already
  open as a permanent tab is not converted to a preview; `promotePreview` clears preview
  status; `updateContent` on a preview promotes it.
- `updateContent`: marks dirty; with `vi.useFakeTimers()`, advancing 5000 ms triggers exactly
  one `uploadContent` call; typing again before 5000 ms resets the timer (advance 4000, type,
  advance 4000 → no save; advance 1000 more → one save).
- `saveDocument`: clears the dirty flag on success; leaves it set if content changed while the
  (mocked, deferred) upload was in flight; shows a toast on failure (`uploadContent`
  resolves `false`).
- `closeDocument`: saves dirty content before removing; activates the tab to the left, or the
  right if leftmost; removing the only tab leaves `activeDocumentId` null.
- `moveTab`: moving right adjusts the index correctly (move tab 0 to index 2 in a 3-tab list →
  order `[1, 0, 2]` by original positions); moving left works; unknown id is a no-op.
- `$reset`: clears everything and cancels pending save timers (advance timers after reset →
  no `uploadContent` call).

**Verify:** `yarn test`. **Commit:** `test: add editor store tests`

---

## Phase 1 — Correctness fixes

Each task here fixes a real bug found in the audit.

### Task 1.1 — Escape admonition titles (stored XSS)

**File:** `src/lib/markdown.ts`
**Anchor:** `<div class="admonition-title">${icon}<span>${t.title}</span></div>`

The admonition title is user-controlled markdown text interpolated into HTML without escaping,
and the result is rendered via `v-html` in `MarkdownPreview.vue`. `||info <img src=x
onerror=alert(1)>` executes script.

Change the interpolation to use the `escapeHtml` helper already defined in this file:

```ts
<div class="admonition-title">${icon}<span>${escapeHtml(t.title)}</span></div>
```

Then add a regression test to `src/lib/markdown.test.ts`:

```ts
describe('admonition security', () => {
  it('escapes HTML in admonition titles', () => {
    const html = parseMarkdown('||info <img src=x onerror=alert(1)>\nbody\n||\n')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })
})
```

**Verify:** `yarn test && yarn type-check`. **Commit:** `fix: escape HTML in admonition titles (XSS)`

### Task 1.2 — Mount the bulk-move UI (dead feature)

**Files:** `src/components/sidebar/LilypadSidebar.vue`

`src/components/sidebar/BulkActionBar.vue` (bulk delete + move toolbar) is imported by nothing
and never mounts, which makes `FolderPickerModal.vue` and the files store's `bulkMove`
unreachable. The feature is complete — it just needs mounting.

In `LilypadSidebar.vue`:

1. Add `import BulkActionBar from './BulkActionBar.vue'` next to the other sidebar imports.
2. Find the anchor `<div v-if="!isMinimized" class="relative flex-1 flex flex-col overflow-hidden">`.
   This div is `position: relative`, and `BulkActionBar` positions itself `absolute bottom-0`,
   so it must be the **last child inside this div** (after the `</template>` that closes the
   files/images tab block):

```html
      <FileExplorer v-if="uiStore.sidebarTab === 'files'" />
      <ImagesTab v-else />
    </template>
    <BulkActionBar />
  </div>
```

The bar renders itself only when 2+ entries are selected (`v-if="count >= 2"` inside the
component), so mounting it unconditionally is correct.

**Verify:** `yarn type-check`, then `yarn dev` and manually confirm: Ctrl+click two files in
the sidebar → a "2 selected / Move / Delete" bar appears at the bottom of the file panel; the
Move button opens the folder picker. **Commit:** `fix: mount BulkActionBar so bulk move is reachable`

### Task 1.3 — Fix comments that describe a nonexistent parameter

**Files:** `src/components/sidebar/FileExplorer.vue`, `src/components/sidebar/ImagesTab.vue`
**Anchor (both files):** `// Pass checkConflict=true so name collisions at root are caught.`
(In ImagesTab the wording is `// Pass checkConflict=true to detect name collisions at the root level.`)

`moveEntry`'s fourth parameter is `silent` (suppresses the error toast so the caller can show
one aggregate toast), not `checkConflict`. Replace both comments with:

```ts
// silent=true: suppress per-entry toasts; we show one aggregate toast for all failures below.
```

**Verify:** `yarn type-check`. **Commit:** `docs: fix stale comments on moveEntry silent param`

### Task 1.4 — Await tab closes before deleting entries

**Files:** `src/components/sidebar/FileExplorerNode.vue`,
`src/components/sidebar/ImageNode.vue`, `src/components/sidebar/BulkActionBar.vue`
**Anchor (all three, inside `handleDelete`):** `editorStore.closeDocument(id)` inside a
`for` loop, and the single-entry call `editorStore.closeDocument(props.entry.id)`.

`closeDocument` is async — it saves dirty content before closing. Because these calls are not
awaited, a dirty document's save can race with the deletion of its DB row and surface a bogus
"Failed to save" toast. Add `await` to every `closeDocument` call inside `handleDelete` in all
three files (the loops become `for (const id of ...) { await editorStore.closeDocument(id) }`).

**Verify:** `yarn type-check && yarn test`. **Commit:** `fix: await tab close/save before deleting entries`

### Task 1.5 — Make bulkMove sequential

**File:** `src/stores/files.ts`
**Anchor:** `async function bulkMove(`

`bulkMove` currently runs all `moveEntry` calls through `Promise.all`. Each `moveEntry`
triggers `renumberSiblings` on the same destination folder, so N renumber passes run
concurrently against state the others are mutating. `useDragDrop.ts` already does this
correctly (sequential, with a comment explaining why). Replace the body:

```ts
async function bulkMove(ids: string[], targetFolderId: string | null): Promise<boolean> {
  const base = getNextSortOrder(targetFolderId)
  // Sequential (not Promise.all): each moveEntry renumbers siblings in the target folder,
  // and concurrent renumber passes would interleave writes against mutating local state.
  let allOk = true
  for (let i = 0; i < ids.length; i++) {
    const ok = await moveEntry(ids[i]!, targetFolderId, base + i * 1000, true)
    if (!ok) allOk = false
  }
  clearSelection()
  return allOk
}
```

**Verify:** `yarn type-check && yarn test`. **Commit:** `fix: run bulkMove sequentially to avoid renumber races`

### Task 1.6 — Delete DB row before Storage blobs

**File:** `src/stores/files.ts`
**Anchor:** `async function deleteEntry(`

Currently `deleteEntry` removes Storage blobs first, then deletes the DB row. If the DB delete
fails, entries remain that point at deleted blobs (broken state). Reorder so the DB delete
happens first — a failed storage cleanup then merely orphans blobs, which is harmless.

Restructure the function to:

1. Compute `idsToDelete` and `storagePaths` (unchanged — do this before any mutation).
2. Run the DB delete (`supabase.from('entries').delete().eq('id', id)`). On error: show the
   existing toast, `return false`. **No storage call has happened yet.**
3. After a successful DB delete, remove the storage blobs. Ignore its error apart from
   `console.error` — the rows are already gone and an orphaned blob is acceptable:

```ts
if (storagePaths.length > 0) {
  const { error: storageErr } = await supabase.storage.from('user-files').remove(storagePaths)
  // Rows are already deleted; an orphaned blob is harmless, so just log.
  if (storageErr) console.error('deleteEntry: failed to remove storage blobs', storageErr)
}
```

4. Keep the rest (local `entries` filter, contentMap/trigram cleanup, selectedFolderId reset)
   exactly as is.

**Verify:** `yarn type-check && yarn test`. **Commit:** `fix: delete DB rows before storage blobs in deleteEntry`

### Task 1.7 — Check errors on placeholder upload in createDocument

**File:** `src/stores/files.ts`
**Anchor:** `// Create an empty Storage placeholder so storage_path is immediately valid.`

Two Supabase calls in the non-md branch of `createDocument` ignore their errors. Capture and
handle them; on failure, delete the just-created DB row so no half-created entry survives:

```ts
if (!isMd) {
  const ext = type === 'pdf' ? 'pdf' : type
  const storagePath = `${auth.user.id}/${data.id}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('user-files')
    .upload(storagePath, new Blob([''], { type: 'text/plain' }))

  const { error: pathErr } = uploadErr
    ? { error: uploadErr }
    : await supabase.from('entries').update({ storage_path: storagePath }).eq('id', data.id)

  if (uploadErr || pathErr) {
    // Roll back the row so no entry exists without a valid storage_path.
    await supabase.from('entries').delete().eq('id', data.id)
    showError('Failed to create file.')
    return null
  }

  data.storage_path = storagePath
} else {
```

**Verify:** `yarn type-check && yarn test`. **Commit:** `fix: handle placeholder upload errors in createDocument`

### Task 1.8 — Don't clobber cloud settings on transient fetch errors

**File:** `src/stores/ui.ts`
**Anchor:** `async function loadSettings(userId: string)`

`loadSettings` treats any missing `data` as "first login" and seeds Supabase with local
values — including when the fetch failed transiently, which overwrites the user's cloud
settings. Distinguish "no row exists" (PostgREST code `PGRST116`) from real errors:

```ts
async function loadSettings(userId: string) {
  const { data, error } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .single()

  // PGRST116 = zero rows for .single() — the only case that means "first login".
  // Any other error is transient/unknown: bail without seeding, so a network blip
  // can't overwrite the user's cloud settings with this device's local values.
  if (error && error.code !== 'PGRST116') {
    console.error('loadSettings failed:', error)
    return
  }

  if (!data) {
    await supabase.from('user_settings').upsert({ user_id: userId, settings: serializeSettings() })
    return
  }
  // ... rest unchanged (hydrating block)
```

**Verify:** `yarn type-check`. **Commit:** `fix: only seed cloud settings when the row is truly absent`

### Task 1.9 — Resolve superseded confirm dialogs

**File:** `src/composables/useConfirm.ts`
**Anchor:** `resolveFn = resolve`

If a second `confirm()` opens while one is pending, the first `resolveFn` is silently
overwritten and its awaiting caller hangs forever. Resolve the old promise as cancelled first.
Inside `confirm()`, immediately before `resolveFn = resolve`, add:

```ts
      // A second dialog supersedes the first: resolve the old promise as "cancelled"
      // so its awaiting caller doesn't hang forever.
      resolveFn?.(false)
```

Also update the stale comment on the module-level state (anchor: `concurrent calls will
clobber each other`) to say concurrent calls cancel the previous dialog.

**Verify:** `yarn type-check`. **Commit:** `fix: resolve superseded confirm dialogs instead of leaking them`

### Task 1.10 — Fix ARIA and Escape handling in ConfirmDialog

**File:** `src/components/ConfirmDialog.vue`

Two fixes:

1. **Anchor:** `:aria-labelledby="title"` — `aria-labelledby` takes element IDs, not text.
   Replace with `:aria-label="title"`.
2. **Anchor:** `@keydown="onKeydown"` on the overlay div — a div without focus never receives
   keydown, so Escape usually does nothing. Replace with a window-level listener that is
   active only while the dialog is open. In the script block:

```ts
import { watch, onBeforeUnmount } from 'vue'

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') onCancel()
}

// Listen globally only while the dialog is open, so Escape works regardless of focus.
watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onWindowKeydown)
  else window.removeEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
```

Remove the old `onKeydown` function and the `@keydown` binding from the template.

**Verify:** `yarn type-check`; `yarn dev` → trigger a delete confirm → press Escape without
clicking anything first → dialog closes. **Commit:** `fix: ConfirmDialog aria-label and global Escape handling`

### Task 1.11 — Only hydrate settings on sign-in, not token refresh

**File:** `src/stores/auth.ts`
**Anchor:** `supabase.auth.onAuthStateChange((_event, newSession) => {`

`onAuthStateChange` fires for `TOKEN_REFRESHED` (~hourly). Each firing calls
`ui.loadSettings`, which can revert a setting the user changed in the last second (the remote
save is debounced 1000 ms). Only hydrate on actual sign-in:

```ts
supabase.auth.onAuthStateChange((event, newSession) => {
  session.value = newSession
  user.value = newSession?.user ?? null
  // Hydrate settings only on a genuine sign-in. TOKEN_REFRESHED fires ~hourly and
  // re-hydrating then can revert a setting changed within the save-debounce window.
  if (event === 'SIGNED_IN' && newSession?.user) {
    useUiStore().loadSettings(newSession.user.id)
  }
})
```

Note: the initial page-load hydration is already handled separately above this listener
(`if (currentSession?.user) ...loadSettings(...)`) — leave that in place.

**Verify:** `yarn type-check`. **Commit:** `fix: hydrate settings only on SIGNED_IN`

**End of Phase 1: run `yarn build` and confirm it passes.**

---

## Phase 2 — Flow consolidation

### Task 2.1 — Make `activeDocument` a computed

**File:** `src/stores/editor.ts`

`activeDocumentId` and `activeDocument` are two refs synced by hand in ~8 places; missing one
causes desync bugs. Replace the ref with a computed:

1. Add `computed` to the vue import.
2. **Anchor:** `const activeDocument = ref<OpenDocument | null>(null)` → replace with:

```ts
// Derived, never assigned: single source of truth is activeDocumentId + openDocuments.
const activeDocument = computed<OpenDocument | null>(() =>
  activeDocumentId.value ? (openDocuments.value.get(activeDocumentId.value) ?? null) : null,
)
```

3. Delete **every** `activeDocument.value = ...` assignment in the file. Find them with a
   search for `activeDocument.value =` — they occur in `openDocument`,
   `openDocumentOptimistic`, `openDocumentAsPreview` (×3), `openDocumentOptimisticAsPreview`
   (×3), `setActiveDocument`, `closeDocument`, and `$reset`. In each case keep the
   `activeDocumentId.value = ...` line and delete only the `activeDocument.value` line. In
   `closeDocument`, the block becomes just `activeDocumentId.value = nextId` (keep the
   `nextId` computation).
4. The `return { ... }` block keeps exporting `activeDocument` unchanged (Pinia exposes
   computeds as readonly getters).
5. Confirm nothing outside the store assigns to it: search the repo for `activeDocument =`
   (with space) — there should be no assignments outside `editor.ts`.

**Verify:** `yarn type-check && yarn test` (the Phase 0 editor tests must still pass).
**Commit:** `refactor: derive activeDocument as a computed`

### Task 2.2 — Collapse the four open* variants into one implementation

**File:** `src/stores/editor.ts`

`openDocument`, `openDocumentOptimistic`, `openDocumentAsPreview`, and
`openDocumentOptimisticAsPreview` share ~80% of their bodies. **Keep all four public
functions** (so no call sites change) but implement them as thin wrappers over one internal
function:

```ts
/**
 * Shared implementation behind the four public open* variants.
 *
 * - preview: open as a VSCode-style preview tab that replaces the current preview tab
 *   in the same slot. Non-preview opens append a permanent tab.
 * - loading: mark the document as still fetching (skeleton) until finishLoadingDocument().
 */
function openDocumentInternal(
  id: string,
  name: string,
  type: DocumentType,
  { content = '', preview = false, loading = false }: {
    content?: string
    preview?: boolean
    loading?: boolean
  } = {},
) {
  // Already open (as this preview or as a permanent tab): just activate.
  if (openDocuments.value.has(id)) {
    activeDocumentId.value = id
    return
  }

  let insertIndex = tabOrder.value.length
  if (preview && previewDocumentId.value) {
    // Replace the existing preview tab in-place so it stays in the same tab slot.
    const oldId = previewDocumentId.value
    insertIndex = tabOrder.value.indexOf(oldId)
    openDocuments.value.delete(oldId)
    dirtyIds.value.delete(oldId)
    loadingIds.value.delete(oldId)
    tabOrder.value.splice(insertIndex, 1)
  }

  openDocuments.value.set(id, { id, name, type, content })
  tabOrder.value.splice(insertIndex, 0, id)
  if (preview) previewDocumentId.value = id

  dirtyIds.value.delete(id)
  if (loading) loadingIds.value.add(id)
  else loadingIds.value.delete(id)
  activeDocumentId.value = id
}

function openDocument(id: string, name: string, type: DocumentType, initialContent = '') {
  openDocumentInternal(id, name, type, { content: initialContent })
}

function openDocumentOptimistic(id: string, name: string, type: DocumentType) {
  openDocumentInternal(id, name, type, { loading: true })
}

function openDocumentAsPreview(id: string, name: string, type: DocumentType, content: string) {
  openDocumentInternal(id, name, type, { content, preview: true })
}

function openDocumentOptimisticAsPreview(id: string, name: string, type: DocumentType) {
  openDocumentInternal(id, name, type, { preview: true, loading: true })
}
```

Behavioral notes to preserve (the Phase 0 tests assert these):

- The old code cleared `loadingIds` in the non-optimistic paths and set it in optimistic
  paths — the internal function above does the same via the `loading` flag.
- The old `openDocument` cleared the dirty flag even when re-activating an already-open
  document. The new early-return does not. This is intentional: clearing dirty on
  re-activation could silently discard the unsaved marker. If a Phase 0 test asserted the old
  behavior, update the test with a comment explaining the change.

Delete the four old bodies. Export list is unchanged.

**Verify:** `yarn type-check && yarn test`. **Commit:** `refactor: unify open* variants behind openDocumentInternal`

### Task 2.3 — Add a single `openEntry` action; use it everywhere

**File:** `src/stores/editor.ts` (add action), then 4 call sites.

The cache-check → open (preview or optimistic) → download → finishLoading dance is duplicated
with variations in four places. Add one canonical action to the editor store:

```ts
/**
 * Canonical "open a file from anywhere" flow (sidebar, quick switcher, search, image pane).
 * Resolves the entry, picks preview vs permanent, serves cached content synchronously when
 * available, and falls back to an optimistic open + network fetch.
 */
async function openEntry(id: string, { preview = false }: { preview?: boolean } = {}) {
  const filesStore = useFilesStore()
  const entry = filesStore.getEntry(id)
  if (!entry || entry.kind !== 'document' || !entry.document_type) return

  const type = entry.document_type

  // Images have no text content; the ImageDetailPane loads the blob itself.
  if (type === 'image') {
    openDocumentInternal(id, entry.name, type, {})
    return
  }

  // Already open as a permanent tab: just activate (don't demote to preview).
  if (openDocuments.value.has(id) && previewDocumentId.value !== id) {
    setActiveDocument(id)
    return
  }

  const cached = filesStore.getCached(id)
  if (cached !== undefined) {
    openDocumentInternal(id, entry.name, type, { content: cached, preview })
    return
  }

  // Not cached: show the tab immediately with a skeleton, fill in when the fetch lands.
  openDocumentInternal(id, entry.name, type, { preview, loading: true })
  const content = await filesStore.downloadContent(id)
  finishLoadingDocument(id, content ?? '')
}
```

Add `openEntry` to the store's return object. Then replace the four call sites:

1. **`src/components/sidebar/FileExplorerNode.vue`**, anchor: the block inside `handleClick`
   starting `if (props.entry.type === 'md' || props.entry.type === 'web') {`. Replace that
   whole block (the permanent-tab check, cached check, optimistic open, download, finish)
   with:

```ts
  if (props.entry.type === 'md' || props.entry.type === 'web') {
    await editorStore.openEntry(props.entry.id, { preview: true })
  }
```

2. **`src/components/QuickSwitcher.vue`**, anchor: `async function openFile(item: FileItem)`.
   Replace the body after `uiStore.closeQuickSwitcher()` with
   `await editorStore.openEntry(item.id)`. Delete the now-unused `filesStore` import **only
   if** nothing else in the file uses it (it does — `allFiles` uses it — so keep the import).

3. **`src/components/editor/ImageDetailPane.vue`**, anchor:
   `function openReferencingDoc(docId: string)`. Replace the body with
   `editorStore.openEntry(docId)`. Remove unused locals.

4. **`src/stores/search.ts`**, anchor: `async function openResult(result: SearchResult)`.
   Replace the open logic (keep the scroll request):

```ts
async function openResult(result: SearchResult) {
  await editorStore.openEntry(result.fileId)
  editorStore.requestScrollToLine(result.fileId, result.lineNumber)
  close()
}
```

   This also removes the incorrect `as 'pdf' | 'md'` cast that mislabeled `web` documents.

**Verify:** `yarn type-check && yarn test`, then `yarn dev` and manually check: single-click a
file (opens as italic preview tab), Ctrl+P open a file (permanent tab), click a search result
(opens and scrolls to line). **Commit:** `refactor: single openEntry action for all open-document flows`

### Task 2.4 — Deduplicate top-level-selection filtering

**File:** `src/stores/files.ts` (add helper), then 3 call sites.

The "skip entries whose ancestor is also selected" loop is copy-pasted in `files.ts`
(`bulkDelete`), `useDragDrop.ts` (`onDrop`), `FileExplorer.vue` (`onRootDrop`), and
`ImagesTab.vue` (`onRootDrop`) — three of the four use O(n) `entries.find()` inside the walk.

1. In `files.ts`, add (near `collectDescendantIds`):

```ts
/**
 * Filters `ids` down to entries whose ancestors are NOT also in `ids`.
 * Moving/deleting a folder already covers its descendants, so bulk operations
 * must act only on these "top-level" ids to avoid double-processing subtrees.
 */
function filterTopLevelIds(ids: Iterable<string>): string[] {
  const idSet = new Set(ids)
  return [...idSet].filter((id) => {
    let parentId = entryById.value.get(id)?.parent_id ?? null
    while (parentId) {
      if (idSet.has(parentId)) return false
      parentId = entryById.value.get(parentId)?.parent_id ?? null
    }
    return true
  })
}
```

2. Export it from the store's return object.
3. Replace the inline loop in `bulkDelete` with `const topLevel = filterTopLevelIds(ids)`.
4. In `useDragDrop.ts` (anchor: `const topLevel = [...idSet].filter((id) => {`), replace the
   filter block with `const topLevel = filesStore.filterTopLevelIds(idSet)`.
5. Same replacement in `FileExplorer.vue` and `ImagesTab.vue` (`onRootDrop`).

**Verify:** `yarn type-check && yarn test`. **Commit:** `refactor: shared filterTopLevelIds for bulk operations`

### Task 2.5 — Merge buildTree / buildImageTree

**File:** `src/stores/files.ts`
**Anchors:** `function buildTree(parentId: string | null)` and `function buildImageTree(`

The two builders are identical except for the row filter. Replace both with one parameterized
builder and two thin wrappers (keep the `tree` / `imageTree` computeds exactly as they are):

```ts
/**
 * Recursively builds a tree rooted at `parentId`, including only rows accepted by `include`.
 * Directories are always recursed into; `include` decides whether a row appears at all.
 */
function buildTreeWith(parentId: string | null, include: (row: EntryRow) => boolean): Entry[] {
  return entries.value
    .filter((e) => e.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .filter(include)
    .map((row) =>
      row.kind === 'directory'
        ? {
            kind: 'directory' as const,
            id: row.id,
            name: row.name,
            parentId: row.parent_id,
            children: buildTreeWith(row.id, include),
          }
        : {
            kind: 'document' as const,
            id: row.id,
            name: row.name,
            parentId: row.parent_id,
            type: row.document_type as DocumentType,
          },
    )
}

// File tree: everything except images (images live in imageTree).
function buildTree(parentId: string | null): Entry[] {
  return buildTreeWith(parentId, (row) => row.document_type !== 'image')
}

// Images tab: image documents plus all directories (folders always shown for structure).
function buildImageTree(parentId: string | null): Entry[] {
  return buildTreeWith(parentId, (row) => row.document_type === 'image' || row.kind === 'directory')
}
```

**Verify:** `yarn type-check && yarn test`; `yarn dev` → files tab shows the tree without
images; images tab shows images grouped in folders. **Commit:** `refactor: merge tree builders behind buildTreeWith`

**End of Phase 2: run `yarn build`.**

---

## Phase 3 — Split the god files

The rule for this phase: **move code, don't change it.** Every extraction is cut-and-paste
plus imports. If you find yourself rewriting logic, stop.

### Task 3.1 — Extract pure tree/ordering helpers to `src/lib/entry-tree.ts`

**Files:** create `src/lib/entry-tree.ts`; edit `src/stores/files.ts`.

Move these as **pure functions taking the data they need as parameters** (they currently close
over `entries.value` / `entryById.value`):

```ts
// src/lib/entry-tree.ts
// Pure helpers over flat EntryRow lists: tree building, ordering, ancestry walks.
import type { EntryRow } from '@/types/database'

export function sortedChildren(entries: EntryRow[], parentId: string | null): EntryRow[] { ... }
export function getNextSortOrder(entries: EntryRow[], parentId: string | null): number { ... }
export function collectDescendantIds(entries: EntryRow[], id: string): string[] { ... }
export function filterTopLevelIds(byId: Map<string, EntryRow>, ids: Iterable<string>): string[] { ... }
export function isDuplicateName(entries: EntryRow[], name: string, parentId: string | null, excludeId?: string): boolean { ... }
export function deduplicateName(entries: EntryRow[], name: string, parentId: string | null): string { ... }
```

Port the bodies verbatim from `files.ts`, replacing `entries.value` with the `entries`
parameter and `entryById.value` with the `byId` parameter. Add `sortedChildren` as the shared
`filter + sort` used by several of them (the `sort_order` asc, then `localeCompare` tiebreak
pattern appears 6+ times in the codebase).

In `files.ts`, keep same-named store functions as one-line delegating wrappers (e.g.
`function getNextSortOrder(parentId) { return entryTreeGetNextSortOrder(entries.value, parentId) }`
using import aliases) so the store's public API and all component call sites stay untouched.

Then create `src/lib/entry-tree.test.ts` covering, with a small hand-built `EntryRow[]`
fixture (3 folders, 4 documents, one nested chain):

- `getNextSortOrder`: empty parent → 1000; otherwise max + 1000.
- `collectDescendantIds`: returns self + all transitive children, depth-first.
- `filterTopLevelIds`: child of a selected folder is filtered out; independent entries pass.
- `isDuplicateName`: detects sibling collision; `excludeId` prevents self-collision on rename.
- `deduplicateName`: `a.md` with existing `a.md` → `a (2).md`; increments past existing ` (2)`.

**Verify:** `yarn type-check && yarn test`. **Commit:** `refactor: extract pure entry-tree helpers with tests`

### Task 3.2 — Extract the CodeMirror theme from TextEditor

**Files:** create `src/components/editor/cm/theme.ts`; edit
`src/components/editor/TextEditor.vue`.

Cut the entire `const lilypadTheme = EditorView.theme({ ... })` block (~160 lines, anchor:
`const lilypadTheme = EditorView.theme({`) into the new file:

```ts
// CodeMirror theme mapping Lilypad design tokens (CSS vars) onto editor chrome.
import { EditorView } from 'codemirror'

export const lilypadTheme = EditorView.theme({
  // ... body unchanged ...
})
```

Import it in TextEditor.vue. Leave the `<style>` block in the .vue file alone (it targets
globally-scoped CM classes and is a separate concern).

**Verify:** `yarn type-check`; `yarn dev` → editor renders with the green theme, search panel
(Ctrl+F inside the editor) still styled. **Commit:** `refactor: extract CodeMirror theme module`

### Task 3.3 — Extract CM widgets, highlight fields, and bullet commands

**Files:** create `src/components/editor/cm/widgets.ts`,
`src/components/editor/cm/highlight.ts`, `src/components/editor/cm/commands.ts`; edit
`TextEditor.vue`.

Move verbatim (cut-and-paste + exports + imports):

- **widgets.ts**: `UploadSpinnerWidget`, `GhostNameWidget`, `RenameAnchorWidget` classes.
- **highlight.ts**: `highlightLineEffect` + `highlightLineField`, `yankFlashEffect` +
  `yankFlashField` (the two StateEffect/StateField pairs at the top of the script).
- **commands.ts**: `indentBullet`, `dedentBullet`.

Each moved symbol gets `export`. TextEditor.vue imports them. Nothing else changes — the
fields/effects are dispatched from the component exactly as before.

**Verify:** `yarn type-check && yarn test`; `yarn dev` → Tab indents a bullet line, a search
result click flashes the line, `yy` in vim mode flashes the yanked line.
**Commit:** `refactor: extract CM widgets, highlight fields, and bullet commands`

### Task 3.4 — Centralize the image-ref regex

**Files:** create `src/lib/image-refs.ts`; edit `src/components/editor/TextEditor.vue`.

The regex `/!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g` is defined once at module level
(`imgRefPattern`) **and re-declared inline three more times** inside `isOverImageRef`, the
`click` handler, and the `contextmenu` handler. Module-level `/g` regexes are also stateful
(`lastIndex`), which the code works around by resetting manually.

Create:

```ts
// src/lib/image-refs.ts
// Single definition of the ![alt](img:<uuid>){size?} reference syntax used in notes.

export interface ImageRefMatch {
  entryId: string
  from: number
  to: number
}

/**
 * Finds all image references in `text`. A fresh regex is created per call so no
 * lastIndex state leaks between callers (module-level /g regexes are stateful).
 */
export function findImageRefs(text: string): ImageRefMatch[] {
  const pattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g
  const results: ImageRefMatch[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    results.push({ entryId: m[1]!, from: m.index, to: m.index + m[0].length })
  }
  return results
}
```

In TextEditor.vue, delete `imgRefPattern` and the three inline `imagePattern` declarations;
rewrite each consumer as a loop over `findImageRefs(...)`:

- `buildGhostDecorations`: loop over `findImageRefs(doc)`; `pos` is `ref.to`; look up
  `filesStore.getEntry(ref.entryId)`.
- `isOverImageRef`: loop over `findImageRefs(line.text)`; hit-test `pos` against
  `line.from + ref.from` / `line.from + ref.to`.
- `click` and `contextmenu` handlers: same hit-test; use `ref.entryId`.

**Verify:** `yarn type-check && yarn test`; `yarn dev` → paste an image into a note, its ghost
name renders after the syntax; Ctrl+click the reference navigates to the image; right-click
shows "Rename image". **Commit:** `refactor: single findImageRefs helper replaces 4 regex copies`

### Task 3.5 — De-statefulize the sentinel regex

**File:** `src/components/editor/TextEditor.vue`
**Anchor:** `const sentinelPattern = /<!--uploading:[a-f0-9-]+-->/g`

Same problem as 3.4: a module-level `/g` regex whose `lastIndex` must be manually reset at
three call sites (`buildUploadDecorations`, `sentinelGuard`, `resolveStashedUploads`). Add a
helper next to the pattern and use it at all three sites, deleting the manual
`sentinelPattern.lastIndex = 0` resets:

```ts
/** All upload sentinels in `doc`, with a fresh regex per call (no lastIndex state). */
function findSentinels(doc: string): { uuid: string; from: number; to: number }[] {
  const pattern = /<!--uploading:([a-f0-9-]+)-->/g
  const results: { uuid: string; from: number; to: number }[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(doc)) !== null) {
    results.push({ uuid: m[1]!, from: m.index, to: m.index + m[0].length })
  }
  return results
}
```

Note for `resolveStashedUploads`: it currently extracts the uuid with a nested
`m[0].match(/[a-f0-9-]+/)` — the helper's capture group replaces that. Keep the
"process one sentinel per call, then return" behavior exactly (the doc changes after each
resolution).

**Verify:** `yarn type-check`; `yarn dev` → paste an image: spinner pill appears and is
replaced by the reference when the upload finishes. **Commit:** `refactor: replace stateful sentinel regex with findSentinels`

**End of Phase 3: run `yarn build`.**

---

## Phase 4 — Shared UI primitives

Create `src/components/ui/` for these. All are Tailwind-only (no scoped CSS needed).

### Task 4.1 — `v-focus` directive

**Files:** `src/main.ts`, then 4 templates.

Four components use the undocumented internal hook `@vue:mounted="($event as any).el.focus()"`
to autofocus inputs. Replace with a directive. In `main.ts`, after `const app = createApp(App)`:

```ts
// Autofocus for inputs that appear conditionally (rename fields, modals).
app.directive('focus', { mounted: (el: HTMLElement) => el.focus() })
```

Replace `@vue:mounted="($event as any).el.focus()"` with `v-focus` in:
`FileExplorerNode.vue`, `ImageNode.vue`, `ImageDetailPane.vue`, `NewWebPageModal.vue`,
`PendingInputRow.vue`. (Search the repo for `@vue:mounted` to catch them all; there must be
zero occurrences left.)

TypeScript note: if `vue-tsc` complains about the unknown directive in templates, add a
`src/types/directives.d.ts` declaring it via `ComponentCustomProperties` — but Vue's default
template checking accepts unknown directives, so this is likely unnecessary.

**Verify:** `yarn type-check`; `yarn dev` → rename a file (F2 path: right-click → Rename) →
input is focused immediately. **Commit:** `refactor: v-focus directive replaces vue:mounted focus hack`

### Task 4.2 — `ToggleSwitch.vue`

**Files:** create `src/components/ui/ToggleSwitch.vue`; edit
`src/components/settings/VimSettings.vue`.

The pill toggle markup is copy-pasted three times in VimSettings (anchors: `role="switch"`).
Create:

```vue
<!-- Accessible on/off switch bound via v-model. -->
<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <button
    role="switch"
    :aria-checked="model"
    class="relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer shrink-0"
    :class="model ? 'bg-accent' : 'bg-surface-overlay'"
    @click="model = !model"
  >
    <span
      class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150"
      :class="model ? 'translate-x-4' : 'translate-x-0'"
    />
  </button>
</template>
```

In VimSettings, replace the three switch buttons with
`<ToggleSwitch :model-value="uiStore.vimEnabled" @update:model-value="uiStore.setVimEnabled" />`
etc. (explicit prop/event form, since the sources are store state with setter actions — do
not `v-model` directly onto store getters).

**Verify:** `yarn type-check`; `yarn dev` → Settings → all three Vim toggles still animate and
persist. **Commit:** `refactor: shared ToggleSwitch component`

### Task 4.3 — `ContextMenu.vue`

**Files:** create `src/components/ui/ContextMenu.vue`; edit `FileExplorerNode.vue`,
`ImageNode.vue`, `TextEditor.vue` (image context menu), `FileExplorer.vue` (empty-area menu).

The Teleport + fixed-position + shadow panel wrapper is duplicated 4×. Create a component that
owns the chrome; callers keep their own items:

```vue
<!-- Fixed-position context menu shell; caller provides items via the default slot. -->
<script setup lang="ts">
defineProps<{ x: number; y: number }>()
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-36 font-ui"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <slot />
    </div>
  </Teleport>
</template>
```

Also add a `ContextMenuItem.vue` for the repeated button styling (props: `danger?: boolean`;
emits `click`; classes copied from the existing menu buttons, red text when `danger`).

Replace the four duplicated menus. Visibility/positioning state stays where it is
(`useContextMenu` composable or local refs) — only the markup moves.

**Verify:** `yarn type-check`; `yarn dev` → right-click a file, an image node, an image
reference in the editor, and empty sidebar space: all four menus render and act as before.
**Commit:** `refactor: shared ContextMenu components`

### Task 4.4 — Named handler for middle-click tab close

**File:** `src/components/editor/EditorTabs.vue`
**Anchor:** the inline `@mousedown="(e: MouseEvent) => {` block on the tab button.

This is a multi-statement arrow function in a template (see rule 7 — Prettier hazard).
Replace with a named method:

```ts
// Middle-click closes the tab (standard tab-strip behavior).
function onTabMouseDown(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    handleClose(id)
  }
}
```

Template: `@mousedown="onTabMouseDown($event, tab.id)"`.

**Verify:** `yarn type-check && yarn build`; `yarn dev` → middle-click a tab closes it.
**Commit:** `refactor: named handler for middle-click tab close`

### Task 4.5 — Shared selection/delete composables for tree rows

**Files:** create `src/composables/useEntrySelection.ts` and
`src/composables/useEntryDelete.ts`; edit `FileExplorerNode.vue`, `ImageNode.vue`.

`FileExplorerNode` and `ImageNode` duplicate ~150 lines of script logic. Do **not** merge the
templates (too risky) — extract the identical script parts:

**useEntrySelection.ts** — takes `entry: Ref<Entry>`, returns `isSelected`,
`isCoveredBySelection`, `inSelectionMode`. Port from FileExplorerNode, with one improvement:
the ancestor walk must use `filesStore.getEntry(parentId)` (O(1) map) instead of
`filesStore.entries.find(...)` (O(n) scan inside a per-node computed — quadratic during
renders).

**useEntryDelete.ts** — takes `entry: Ref<Entry>` plus the selection refs from
`useEntrySelection`, returns `handleDelete`. Port the multi-select-vs-single confirm + close
tabs (with `await`, per Task 1.4) + `bulkDelete`/`deleteEntry` flow. The only difference
between the two components is the single-item message ("This file..." / "This image..." /
folder message) — pass the noun as an option: `useEntryDelete(entry, sel, { noun: 'image' })`.

Both components delete their local copies and consume the composables.

**Verify:** `yarn type-check && yarn test`; `yarn dev` → Ctrl+click multi-select still
highlights covered children; deleting a multi-selection from either tab works.
**Commit:** `refactor: shared selection and delete composables for tree rows`

**End of Phase 4: run `yarn build`.**

---

## Phase 5 — Small cleanups

Each of these is tiny; batch them as individual commits in any order.

### Task 5.1 — Remove dead `haystack` in search store

**File:** `src/stores/search.ts`. **Anchor:** `void haystack`.
`searchLiteral` computes a whole-content `haystack`/`needle` pair but matches per-line; the
variable is dead and kept alive by a `void` lint suppression. Delete the `haystack`
declaration, the `void haystack` line, and the comment above it. Keep `needle` **only if**
still used (it is — the per-line `indexOf(needle)`; note `needle` is derived from `query`,
keep it).

**Commit:** `chore: remove dead haystack variable in searchLiteral`

### Task 5.2 — Reuse the Marked instance across renders

**File:** `src/lib/markdown.ts`. **Anchor:** `export function parseMarkdown(`.
A new `Marked` with four extensions is constructed on every call (i.e., after nearly every
keystroke). Hoist construction to module scope; route the per-call `imageResolver` through a
module-level variable:

```ts
// The image extension reads this at render time so one shared Marked instance can serve
// every caller; parseMarkdown sets it before each parse.
let activeImageResolver: ((imageId: string) => string | null) | undefined

const sharedMarked = new Marked()
sharedMarked.use(markedKatex({ throwOnError: false, macros }))
sharedMarked.use({ extensions: [admonition] })
sharedMarked.use({ breaks: true, renderer: sourceLineRenderer })
sharedMarked.use({ extensions: [ /* blockKatex extension object, unchanged */ ] })
sharedMarked.use({ extensions: [createImageSizeExtension((id) => activeImageResolver?.(id) ?? null)] })

export function parseMarkdown(content: string, imageResolver?: (imageId: string) => string | null): string {
  activeImageResolver = imageResolver
  const tokens = sharedMarked.lexer(content)
  annotateSourceLines(tokens, 0)
  return sharedMarked.parser(tokens)
}
```

The existing `markdown.test.ts` suite is the regression net here — it must pass unchanged.

**Commit:** `perf: reuse a single Marked instance across renders`

### Task 5.3 — Honest preview debounce

**File:** `src/components/editor/MarkdownPreview.vue`. **Anchor:** `5 ms debounce`.
The comment claims the 5 ms debounce prevents per-keystroke re-renders; at typing speed it
does not (keystrokes are >5 ms apart). Raise the delay to `50` and rewrite the comment:

```ts
// 50 ms debounce: coalesces re-renders during fast typing bursts while staying
// imperceptible. (Anything under a keystroke interval re-renders every keypress.)
```

**Commit:** `fix: preview debounce actually coalesces keystrokes`

### Task 5.4 — Validate Supabase env vars at startup

**File:** `src/lib/supabase.ts`. Add before `createClient`:

```ts
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check your .env file (see README).',
  )
}
```

**Commit:** `chore: fail fast on missing Supabase env vars`

### Task 5.5 — Log background save/renumber failures

**Files:** `src/stores/files.ts` (`renumberSiblings`), `src/stores/ui.ts` (`scheduleSave`).
Both fire Supabase writes whose failures currently vanish. In `renumberSiblings`, collect the
update promises' results and `console.error` failures (local sort_order has already been
mutated; a log is enough to make divergence diagnosable). In `scheduleSave`, replace the bare
`.then()` with `.then(({ error }) => { if (error) console.error('settings save failed:', error) })`.

**Commit:** `chore: log background Supabase write failures`

### Task 5.6 — Document the beforeunload save limitation

**File:** `src/App.vue`. **Anchor:** `function onBeforeUnload`.
`saveAll()` fires async Supabase requests during unload; the browser may kill them. A real fix
(keepalive REST calls) isn't worth the complexity today. Add an honest comment above
`editorStore.saveAll()`:

```ts
// Best-effort: these saves are async and the browser may kill them during unload.
// The preventDefault dialog above is the real safety net for dirty documents.
```

**Commit:** `docs: note best-effort nature of beforeunload saves`

### Task 5.7 — Prefer `getEntry` over linear scans

**Files:** search the repo for `entries.find((e) => e.id ===` (and the `en.id ===` variant).
Every occurrence in components (`BreadcrumbBar.vue`, `ImageDetailPane.vue`, `FileExplorer.vue`,
`ImagesTab.vue`, `useDragDrop.ts`, `search.ts`) should call `filesStore.getEntry(id)` /
`getEntry(id)` instead — it's the store's O(1) map lookup and already exported. Mechanical
replacement; the surrounding null-handling (`?.`, `?? null`) stays identical.

**Commit:** `perf: replace linear entry scans with getEntry lookups`

---

## Explicitly out of scope (do NOT do these)

- **Do not** rewrite the admonition tokenizer's `||` handling (`||` inside bodies, e.g. LaTeX
  norms, breaks the block). Known limitation; a syntax change needs a product decision.
- **Do not** convert the request/ack store refs (`scrollToLineRequest`,
  `clearHighlightRequest`) to an event bus. The pattern is documented and working.
- **Do not** merge the FileExplorerNode/ImageNode *templates* into one component.
- **Do not** implement keepalive saves for `beforeunload` (Task 5.6 documents instead).
- **Do not** touch `tools/capture.mjs`, `api/capture.ts`, or the SSRF checks.
- **Do not** upgrade dependencies.

## Completion checklist

After all phases:

```bash
yarn lint
yarn type-check
yarn test
yarn build
```

All four must pass. Then `yarn dev` and walk through: create/rename/delete a file, multi-select
delete and move, paste an image, search and click a result, quick-switch (Ctrl+P), toggle Vim
mode, capture a web page. If any flow regresses, `git log` this branch — every task is one
commit, so `git bisect` between the phase boundaries finds the culprit fast.
