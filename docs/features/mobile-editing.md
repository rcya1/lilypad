# Mobile App — Structure & Layout for Editing on Small Screens

**Status:** Design draft — architecture locked, editing details flexible
**Depends on:** `docs/features/preview-mode.md` (ships first; this doc builds on its
groundwork: shared `markdown-body.css`, heading slugs/TOC, the `/read` reading surface)
**Audience:** Build instructions for a future implementer. Decisions marked **(locked)**
are settled — implement as written.
**Related code:** `src/components/AppShell.vue`, `src/stores/editor.ts`,
`src/components/editor/TextEditor.vue`, `src/stores/ui.ts`, `src/stores/files.ts`

---

## 0. Decisions locked

| # | Decision | Choice |
| --- | --- | --- |
| Strategy | Responsive CSS vs. separate mobile shell | **Separate mobile shell** (`MobileShell.vue`) chosen at runtime by viewport width; the desktop layout is never restyled |
| Layout model | How the app is structured on a phone | **Single-pane navigation stack**: Browse → Document. One thing on screen at a time; no split panes, no tab bar |
| Editor/preview | How the split pane translates | A **segmented Read ⇆ Edit toggle** in the app bar. Read = rendered markdown (reader components); Edit = full-screen CodeMirror |
| Editor engine | What powers mobile editing | The existing **CodeMirror 6 `TextEditor.vue`**, reused — not a plain `<textarea>`, not a new editor |
| Vim | Vim keybindings on mobile | **Force-disabled** in the mobile shell regardless of the `vimEnabled` setting (don't mutate the setting — bypass it) |
| Keyboard helper | Markdown affordances while typing | A **formatting toolbar** pinned above the virtual keyboard (bold, italic, heading, list, code, math) |
| Open documents | Do tabs exist on mobile? | The `editor` store still tracks open documents, but the UI shows only the active one; an "open notes" bottom sheet replaces the tab bar |
| File management | Create/rename/delete/move on mobile | **Long-press action sheet** per row + a floating "new note" button; move uses the existing `FolderPickerModal` pattern rebuilt as a sheet |
| Relationship to `/read` | Two mobile surfaces? | **No — they merge.** The mobile shell absorbs preview mode's components: `/read`'s browser and document views *become* the mobile shell's Browse and Document(Read) screens |

---

## 1. Vision

Preview mode (see its doc) makes Lilypad *readable* on a phone. This feature makes it
*usable*: capture a thought, fix a typo, reorganize a folder — all from a small screen —
while the desktop app remains the place for serious writing sessions.

The mental model is a two-level navigation stack, like a notes app on any phone:

```
Level 1: BROWSE                      Level 2: DOCUMENT
┌─────────────────────────┐          ┌─────────────────────────┐
│ Lilypad          🔍  ⚙ │          │ ←  Note title  [Read|Edit]│ ← segmented toggle
├─────────────────────────┤          ├─────────────────────────┤
│ ▾ 📁 Math               │          │ # Real Analysis          │
│     📄 Real Analysis    │─ tap ──▶ │ Let $(X, d)$ be a        │
│     📄 Topology         │          │ metric space…            │
│ 📄 Reading list         │          │                          │
│                         │          │  (Read: rendered md,     │
│                    ┌──┐ │          │   TOC available)         │
│                    │ +│ │          │  (Edit: CodeMirror,      │
│                    └──┘ │          │   toolbar above kbd)     │
└─────────────────────────┘          └─────────────────────────┘
   long-press row → action sheet
   (rename / move / delete)

DOCUMENT in Edit mode with keyboard up:
┌─────────────────────────┐
│ ←  Note title  [Read|Edit]
├─────────────────────────┤
│ ## Definitions          │
│ A **metric** on X is▌   │  ← CodeMirror, full width
│                         │
├─────────────────────────┤
│ B  I  H  ••  ``  $  ⤺  │  ← formatting toolbar (pinned above keyboard)
├─────────────────────────┤
│ [   virtual keyboard   ]│
└─────────────────────────┘
```

Navigation summary:

- **Browse** = the file tree (folders expand in place) + search + settings + new-note FAB.
- **Document** = one note, defaulting to **Read**; flip the segmented control to **Edit**.
- Back button / browser-back pops Document → Browse. URL-driven throughout, so refresh
  and deep links work.

---

## 2. Goals / Non-goals

### Goals

- Full CRUD on notes and folders from a phone: create, rename, move, delete, reorder-free
  (sort order keeps whatever it is; drag-reorder is desktop-only).
- Comfortable *basic* editing: CodeMirror with word-wrap, 16px font, markdown syntax
  highlighting, autosave (the editor store's 5s debounce already handles this), and a
  formatting toolbar so common markdown doesn't require symbol-keyboard gymnastics.
- Seamless Read ⇆ Edit round-trip on one note with scroll position roughly preserved
  (edit the section you were reading).
- Search from Browse (trigram index already exists in the `search` store).
- Keyboard-safe layout: the editor and toolbar resize with the virtual keyboard instead
  of being covered by it.
- Desktop remains byte-for-byte untouched in look and behaviour at ≥ 768px.

### Non-goals

- Feature parity with desktop. Explicitly desktop-only: split panes, tabs UI,
  drag-and-drop (files and tab reorder), multi-select/bulk actions, Vim, the
  editor↔preview cursor/block sync, image upload management UI, PDF/web viewing.
- Native apps / PWA installability / offline. (A PWA manifest is a cheap later add.)
- Collaborative or conflict-resolving sync. Same last-write-wins as desktop.
- Tablet-optimized in-between layouts. One breakpoint: `< 768px` = mobile shell.

---

## 3. Structure

### 3.1 Shell selection (locked)

Create `src/composables/useViewport.ts`:

```ts
// Reactive viewport flag. Single breakpoint shared app-wide.
export function useViewport(): { isMobile: Ref<boolean> }
// implementation: matchMedia('(max-width: 767px)'), listen to `change`,
// clean up on scope dispose. No resize polling.
```

`AppShell.vue` becomes a two-line switch:

```vue
<MobileShell v-if="isMobile" />
<template v-else> <LilypadSidebar /> <EditorPane /> </template>
```

Crossing the breakpoint live (rotating a tablet, resizing a window) swaps shells; both
read the same Pinia stores, so open documents and dirty state survive the swap. Pending
CodeMirror edits are already pushed to the store on every keystroke (`updateContent`),
so nothing is lost when `TextEditor` unmounts.

**Routing:** with the mobile shell in place, the `/read` redirect from the preview-mode
doc is superseded — `/` at < 768px renders `MobileShell` directly. Migrate the `/read/*`
routes to be the mobile shell's internal routes (keep the URLs working):

- `/read` → Browse screen
- `/read/:entryId` → Document screen (Read mode)
- `/read/:entryId?mode=edit` → Document screen (Edit mode)

On desktop widths, `/read/*` still renders the read-only reader (preview mode's original
promise: a clean reading view on any device). The document screen only offers the Edit
toggle when `isMobile` — on desktop `/read` stays read-only and "Edit" is E1's jump to
the full editor.

### 3.2 Component tree

```
src/components/mobile/
├─ MobileShell.vue          ← router-view container + shared app-bar slot logic
├─ MobileBrowse.vue         ← wraps/extends ReaderBrowser: tree + FAB + long-press actions
├─ MobileDocument.vue       ← app bar w/ Read|Edit segmented control; hosts one of:
│    ├─ ReaderDocument.vue  ←   Read mode (reused verbatim from preview mode)
│    └─ MobileEditor.vue    ←   Edit mode: TextEditor + formatting toolbar + keyboard mgmt
├─ MobileEditorToolbar.vue  ← the formatting bar (pure UI; emits command names)
├─ MobileActionSheet.vue    ← generic bottom action sheet (list of labeled actions)
├─ MobileFolderPicker.vue   ← "move to…" folder chooser as a sheet
└─ MobileSearch.vue         ← full-screen search over the search store
```

Reuse without modification: `ReaderDocument.vue`, `ReaderTocSheet.vue`,
`markdown-body.css`, `ConfirmDialog.vue`, `ToastContainer.vue`, all stores. `TextEditor.vue`
needs the small prop additions in §4.2 (additive; desktop callers unchanged).

### 3.3 Store usage (no new stores)

| Concern | Where it lives | Mobile-specific notes |
| --- | --- | --- |
| Which note is open | **the URL** (`/read/:entryId`), mirrored into `editorStore.openEntry(id)` on Document mount | URL is the source of truth; the store follows it |
| Read/Edit mode | URL query `?mode=edit` | So back-button exits Edit → Read naturally |
| Content, dirty, autosave | `editor` store, unchanged | 5s idle autosave + `saveAll` on `beforeunload` already exist; additionally flush `saveDocument(id)` when leaving Edit mode or on `visibilitychange → hidden` (mobile tab discards are common) |
| Tree, CRUD, search index | `files` store, unchanged | `createDocument`, `renameEntry`, `deleteEntry`, `moveEntry` are all UI-agnostic already |
| Settings | `ui` store | reuse `previewFontSize`; ignore `vimEnabled` in the mobile shell (§0) |

The one store addition: `pendingCreate`/`triggerCreate` (inline-rename rows) are
keyboard-and-mouse shaped; the mobile FAB instead opens a minimal name prompt (a small
sheet with a text input) and calls `createDocument(name, 'md', parentId)` directly.

---

## 4. Layout details

### 4.1 Browse screen

`ReaderBrowser` from preview mode, plus:

- **FAB** (floating action button): fixed bottom-right (`bottom: max(16px,
  env(safe-area-inset-bottom))`), 56px, `bg-accent text-white rounded-full shadow`, lucide
  `Plus`. Tap → action sheet: "New note" / "New folder", created in the currently
  selected folder (`filesStore.selectedFolderId`) or root.
- **Long-press** (pointer down ≥ 500ms without movement; also `contextmenu` event so
  desktop-narrow windows work) on a row → `MobileActionSheet` with: Rename, Move to…,
  Delete (destructive styling, then the existing `useConfirm` dialog). Rename opens the
  same name-prompt sheet pre-filled.
- App bar: search icon → `MobileSearch`; gear icon → settings (Phase 5; reuse
  `SettingsModal` as a full-screen page, hiding the Vim section on mobile).

### 4.2 Document screen — Edit mode

**`MobileEditor.vue`** hosts the existing `TextEditor.vue` full-bleed. `TextEditor`
gains two optional props (additive, default preserves desktop behaviour):

- `forceVimOff?: boolean` — skip the Vim extension entirely when true.
- `mobile?: boolean` — when true: font-size 16px minimum (iOS zooms into focused inputs
  with smaller fonts), increased touch padding, and no line-flash/scroll-request wiring
  (the cross-pane sync features are desktop-only).

**Keyboard management (the hard part):** pin the toolbar above the virtual keyboard and
keep the cursor visible.

- Root of `MobileDocument` uses `height: 100dvh` layout; the editor scroller flexes.
- Listen to `window.visualViewport` `resize`/`scroll`: set the shell's height to
  `visualViewport.height` (via a CSS var, e.g. `--vvh`) so the toolbar — a normal
  flex-row at the bottom of the shell — sits exactly on top of the keyboard. This is the
  standard technique; do not hardcode keyboard heights.
- After applying, call CodeMirror's `EditorView.scrollIntoView` on the main selection so
  the cursor isn't left under the keyboard.

**`MobileEditorToolbar.vue`** — one horizontal scrollable row, 44px tall,
`bg-surface border-t border-border-subtle`, buttons emit command names; `MobileEditor`
maps them to CodeMirror transactions (put the transaction helpers in
`src/components/editor/cm/commands.ts` next to the existing command code):

| Button | Behaviour |
| --- | --- |
| **B** / *I* | wrap/unwrap selection in `**` / `*` (cursor between markers when no selection) |
| H | cycle heading level of current line: none → `#` → `##` → `###` → none |
| •• | toggle `- ` list prefix on selected lines |
| `` ` `` | inline code wrap; long-press → fenced code block |
| $ | wrap selection in `$…$`; long-press → `$$` block |
| ⤺ / ⤻ | undo / redo (CodeMirror history) |

Keep it to these seven in v1. No admonition/table/image buttons yet.

**Mode switching:** the segmented control writes `?mode=edit` / removes it via
`router.replace`. On Edit → Read, flush `saveDocument` and re-render happens naturally
(ReaderDocument reads store content — see O2). Rough scroll preservation: on switch,
capture the top visible source line (CodeMirror) or the top visible
`data-source-line` element (reader), and scroll the other surface to the matching
line/element — both surfaces already speak `data-source-line`, so this is a lookup, not
new infrastructure. Best-effort; do not build precise sync.

### 4.3 Touch & platform conventions (apply everywhere)

- Tap targets ≥ 44×44px; row height ≥ 44px; icons 20px.
- `active:` states instead of `hover:` for primary feedback (hover styles may remain —
  they're inert on touch).
- Safe areas: `env(safe-area-inset-top)` on app bars, `-bottom` on toolbars/FAB/sheets.
- Sheets and dialogs: dismiss on scrim tap; destructive actions always confirm via
  `useConfirm`.
- No new dependencies for gestures/sheets — long-press is a timer, sheets are
  fixed-position divs with CSS transitions (same as `ReaderTocSheet`).
- `touch-action: manipulation` on interactive elements to kill the 300ms-tap/double-tap
  zoom ambiguity inside the app chrome.

---

## 5. Phased implementation plan

Prereq: preview mode Phases 1–4 shipped. Run `yarn type-check` + `yarn lint` per phase.

**Phase 0 — Shell switch.** `useViewport`, `MobileShell` rendering the existing reader
screens inside it, `AppShell` branch, route migration (§3.1). ✅ *Accept:* at 375px, `/`
shows Browse; at ≥ 768px nothing about desktop changed (verify by loading `/`, editing,
resizing across the breakpoint and back without losing unsaved text).

**Phase 1 — Edit mode, minimal.** `MobileDocument` with the segmented control,
`MobileEditor` hosting `TextEditor` (`forceVimOff`, `mobile`, 16px), `?mode=edit`
round-trip, save-on-exit + `visibilitychange` flush. No toolbar yet. ✅ *Accept:* on a
real phone (or iOS simulator — this phase is not verifiable in a desktop browser alone),
type into a note, background the tab, reopen: text persisted; Read mode shows the edit.

**Phase 2 — Keyboard & toolbar.** `visualViewport` height wiring, cursor-visibility
scroll, `MobileEditorToolbar` with the seven commands + CM transaction helpers and unit
tests for the wrap/toggle logic. ✅ *Accept:* keyboard up → toolbar rides directly above
it; every button produces correct markdown at cursor/selection; undo works.

**Phase 3 — File management.** FAB + name-prompt sheet, long-press action sheet,
rename/move/delete flows (`MobileFolderPicker`, `useConfirm`). ✅ *Accept:* full create →
rename → move → delete lifecycle on a phone, with error toasts surfacing (duplicate names
etc. — the `files` store already toasts these).

**Phase 4 — Search.** `MobileSearch` full-screen view over the `search` store; result
tap → Document(Read). ✅ *Accept:* search finds content and filenames; results navigate.

**Phase 5 — Polish & settings.** Settings as a page (font size, dark mode; Vim section
hidden), Read⇆Edit scroll preservation, `document.title`, active states, safe-area audit,
empty/error states.

---

## 6. Open questions

- **O1 — CodeMirror on-screen-keyboard quirks:** CM6 is generally solid on mobile, but
  autocorrect/autocapitalize interplay with markdown syntax can be annoying. Start with
  `autocapitalize="sentences"`, `autocorrect` on; revisit only on real-device feedback.
  If CM6 proves unusable on some Android keyboard, the fallback is a plain `<textarea>`
  bound to `updateContent` — the store layer doesn't care. Decide only with evidence.
- **O2 — Read-mode freshness:** `ReaderDocument` fetches via the `files` store cache,
  while live edits sit in the `editor` store until autosave. When entering Read mode
  from Edit, render from `editorStore.openDocuments.get(id)?.content` when present so
  the user always reads what they just typed. (Small prop or lookup added in Phase 1.)
- **O3 — Images in mobile notes:** inserting images requires the upload flow
  (`filesStore.uploadImage`) + `img:` reference insertion. Deferred past Phase 5; a
  natural extension of the toolbar (camera-roll button).
- **O4 — Conflict window:** editing the same note on phone and desktop simultaneously is
  last-write-wins with a 5s debounce; unchanged from desktop↔desktop today. Acceptable;
  revisit only if it bites.
- **O5 — PWA manifest:** cheap add (installable icon, standalone display) once the
  mobile shell exists; not part of this plan.
