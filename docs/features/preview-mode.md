# Preview Mode — Mobile-Friendly Reader

**Status:** Design locked — ready to implement
**Audience:** This doc is written as build instructions. Follow the phases in order; each phase
ends with acceptance checks. Where a decision is marked **(locked)**, do not revisit it —
implement as specified.
**Related code:** `src/router/index.ts`, `src/lib/markdown.ts`,
`src/components/editor/MarkdownPreview.vue`, `src/stores/files.ts`, `src/stores/ui.ts`

---

## 0. Decisions locked

| # | Decision | Choice |
| --- | --- | --- |
| Entry point | How you get to preview mode | New routes `/read` (browser) and `/read/:entryId` (document), behind the existing auth guard |
| Shell | Relationship to the desktop app | **Completely separate component tree** under `src/components/reader/` — do NOT modify `AppShell.vue`, `EditorPane.vue`, or the sidebar |
| Rendering | How markdown is rendered | Reuse `parseMarkdown()` from `src/lib/markdown.ts` unchanged; extract the typography CSS out of `MarkdownPreview.vue` into a shared stylesheet (never duplicate it) |
| TOC | Table of contents | Generated from heading tokens at render time; headings get GitHub-style `id` slugs; TOC opens as a bottom sheet |
| Editing | Can you edit in preview mode? | **No.** Read-only in v1. An "Edit" button is Extension E1; inline editing is Extension E2 (see the separate mobile-editing doc) |
| Scope of doc types | Which documents render | `md` fully rendered; `image` shown full-width; `pdf` and `web` show a "view on desktop" placeholder |
| Mobile redirect | Do phones land here automatically? | Yes: navigating to `/` with viewport width < 768px redirects to `/read`, with a `?desktop=1` escape hatch |
| State | New Pinia store? | **No new store.** Reuse `files` store for the tree/content and `ui` store for dark mode. Preview mode never touches the `editor` store |

---

## 1. Vision

A second face of Lilypad: open it on a phone (or a narrow window, or a tablet on the couch)
and get a beautiful, distraction-free, *read-only* rendering of your notes. No tabs, no
split panes, no CodeMirror — just the rendered page, a fast way to jump between notes, and
a table of contents for long documents.

The design goal is **zero-friction navigation between rendered notes**:

- Open the app → you see your notes list immediately.
- Tap a note → full-screen rendered markdown, typographically comfortable.
- One tap opens the TOC; one tap opens the note browser; search is always one tap away.
- The URL is shareable/bookmarkable per note (`/read/:entryId`).

### Target layout (phone)

```
Document view (/read/:id)              Browser view (/read)
┌─────────────────────────┐            ┌─────────────────────────┐
│ ←   Note title    ☰  ⋮ │  app bar   │ Lilypad          🔍  ⋮ │
├─────────────────────────┤            ├─────────────────────────┤
│                         │            │ ▸ 📁 School             │
│  # Rendered heading     │            │   ▾ 📁 Math             │
│  Body text in Open      │            │     📄 Real Analysis    │
│  Sans, comfortable      │            │     📄 Topology         │
│  measure, KaTeX math,   │            │ 📄 Reading list         │
│  admonitions, images…   │            │ 📄 Welcome              │
│                         │            │                         │
│                         │            │                         │
└─────────────────────────┘            └─────────────────────────┘
  ☰ = TOC bottom sheet                   tap file → /read/:id
  ← = back to browser                    tap folder → expand/collapse
```

TOC bottom sheet (over the document view):

```
┌─────────────────────────┐
│         (page)          │
├───────── ▔▔▔ ───────────┤  ← drag handle
│ On this page            │
│   Introduction          │
│   Definitions           │
│     Metric spaces       │  ← indented by heading depth
│   Theorem 1.2           │
└─────────────────────────┘
  tap item → smooth-scroll to heading, sheet closes
```

---

## 2. Goals / Non-goals

### Goals

- Pure rendered view of `md` notes, identical typography to the desktop preview pane
  (same CSS, same `parseMarkdown` pipeline — one source of truth).
- Mobile-first layout: full-width content, 16px+ body text, touch targets ≥ 44px,
  safe-area-inset padding, no hover-dependent affordances.
- Fast note-to-note navigation: file browser view, per-note URLs, browser back/forward works.
- Rendered TOC from the note's headings, with tap-to-scroll.
- Dark mode works (the `ui` store already toggles `.dark` on `<html>`).
- Works equally as a "clean reading view" on desktop (it's just a route — nothing is
  UA-sniffed except the initial `/` redirect).

### Non-goals (v1)

- **No editing** of any kind (Extension E1/E2, and the mobile-editing design doc).
- No PDF or captured-web-page rendering (placeholder screens only).
- No offline support / PWA / service worker.
- No search UI in v1 (Extension E3 — the trigram index already exists, so this is cheap later).
- No tabs, no multi-document state — exactly one note is "open" at a time, driven by the URL.
- No changes to desktop components. If you find yourself editing `EditorPane.vue`,
  `LilypadSidebar.vue`, or `AppShell.vue`, stop — you are off-plan.

---

## 3. Architecture

### 3.1 New files

```
src/components/reader/
├─ ReaderShell.vue        ← route component for /read and /read/:entryId; owns the app bar
├─ ReaderBrowser.vue      ← note tree (the /read "home" view)
├─ ReaderDocument.vue     ← fetches + renders one note (the /read/:entryId view)
├─ ReaderTocSheet.vue     ← bottom sheet listing headings; emits heading id on tap
src/assets/markdown-body.css   ← typography extracted from MarkdownPreview.vue (see 3.3)
```

Modified files (the complete list — nothing else changes):

```
src/router/index.ts        ← add the /read routes + the small-viewport redirect
src/lib/markdown.ts        ← heading id slugs + parseMarkdownWithToc()
src/components/editor/MarkdownPreview.vue  ← swap its typography CSS for the shared import
```

### 3.2 Routing (locked)

Add to `src/router/index.ts`:

```ts
{
  path: '/read',
  name: 'reader',
  component: ReaderShell,
  children: [
    { path: '', name: 'reader-browser', component: ReaderBrowser },
    { path: ':entryId', name: 'reader-document', component: ReaderDocument, props: true },
  ],
}
```

- The existing `beforeEach` auth guard already redirects unauthenticated users to `/login`
  for any route that isn't `login` — the new routes inherit this with **no guard changes**
  beyond the redirect below.
- **Small-viewport redirect:** in the same `beforeEach`, after the auth checks, add:
  if `to.name === 'app'` and `window.innerWidth < 768` and `to.query.desktop !== '1'`,
  return `{ name: 'reader-browser' }`. That is the entire "mobile detection" — no user-agent
  sniffing. `/read` is always reachable on desktop by typing the URL.
- `src/index.css` sets `html, body { height: 100vh; overflow: hidden }`. Keep that; the
  reader's scroll container is an inner `div` with `overflow-y-auto` (same pattern as
  `MarkdownPreview.vue`), and use `h-dvh` (not `h-screen`) on the shell root so mobile
  browser chrome collapsing doesn't clip the layout.

### 3.3 Shared markdown typography (locked — do this first)

`MarkdownPreview.vue` currently holds ~250 lines of `:deep()` CSS styling `.markdown-body`
(headings, code, tables, admonitions, KaTeX spacing, images…). Preview mode must render
**identically**, so this CSS must be shared, not copied:

1. Create `src/assets/markdown-body.css`. Move every rule from `MarkdownPreview.vue`'s
   `<style scoped>` that styles content *inside* `.markdown-body` — headings, paragraphs,
   links, code, pre, blockquote, lists, tables, hr, images/figures, `.katex-display`,
   admonitions — rewriting `:deep(X)` as plain `.markdown-body X`. These rules only use
   design-token CSS vars, so they work unscoped and in dark mode automatically.
2. **Leave behind** in `MarkdownPreview.vue` (still scoped): everything mentioning
   `.preview-hover`, `.preview-selected`, or `.li-text` display rules — that's
   editor-sync behaviour the reader doesn't have — plus the `box-shadow` card rule on
   `.markdown-body` itself.
3. Import the new file from both `MarkdownPreview.vue` and `ReaderDocument.vue`
   (`import '@/assets/markdown-body.css'`).
4. Verify the desktop preview is pixel-identical before moving on (open a note with
   headings, code, a table, math, and an admonition).

### 3.4 Heading ids + TOC extraction (`src/lib/markdown.ts`)

Headings currently render with **no `id` attribute**, so there is nothing for a TOC to
anchor to. Change the `heading` renderer in `sourceLineRenderer` and add a TOC API:

- **Slugs:** GitHub-style — take the heading's plain text, lowercase, trim, replace
  spaces with `-`, strip characters other than `[a-z0-9-_]`. Deduplicate within one
  document by appending `-1`, `-2`, … on repeats. Reset the dedupe counter per parse
  (a module-level `Map` cleared at the top of `parseMarkdown`, same pattern as
  `activeImageResolver`).
- Heading renderer emits `<h2 id="metric-spaces" data-source-line="…">…</h2>`.
  Use the token's raw text (`token.text`) for slugging, not the rendered inline HTML.
- **New export:**

```ts
export interface TocItem {
  depth: number   // 1–6
  text: string    // plain heading text
  id: string      // the slug, matching the rendered id
}

export function parseMarkdownWithToc(
  content: string,
  imageResolver?: (imageId: string) => string | null,
): { html: string; toc: TocItem[] }
```

Implement `parseMarkdown` as a thin wrapper that discards the `toc`. Collect `TocItem`s
while walking the lexed tokens (top-level `heading` tokens only — nested headings inside
admonitions are out of scope for the TOC). The slug used in the TOC and the slug rendered
into the heading **must come from the same slugger pass** so they can never drift.

Add unit tests in `src/lib/markdown.test.ts`: ids on headings, dedupe (`## A`, `## A` →
`a`, `a-1`), TOC order/depth, and that two consecutive `parseMarkdown` calls don't leak
dedupe state between documents.

### 3.5 Components

**`ReaderShell.vue`** — root layout: `flex flex-col h-dvh bg-bg font-ui`, with a sticky
app bar (`bg-surface border-b border-border-subtle`, `pt-[env(safe-area-inset-top)]`) and
`<router-view/>` filling the rest. The app bar contents are driven by the child route:

- On `reader-browser`: Lilypad icon + wordmark (`font-display`), right side reserved for
  Extension E3 (search).
- On `reader-document`: back button (`router.push({ name: 'reader-browser' })`), note
  name (truncated, `text-text-primary`), TOC button (lucide `TableOfContents` icon) that
  opens `ReaderTocSheet`. Hide the TOC button when the note has no headings.
- All tap targets: min `w-11 h-11` (44px), centered icons at 20px.

**`ReaderBrowser.vue`** — the note tree.

- Call `filesStore.fetchEntries()` on mount **only if** `filesStore.entries.length === 0`
  (the desktop shell may have already loaded them in the same session).
- Render `filesStore.tree` recursively (write a small local recursive component or a
  self-referencing template — do NOT reuse `FileExplorerNode.vue`, which carries
  drag-drop/multi-select/context-menu weight the reader must not have).
- Folders: amber `Folder` icon, tap toggles expand/collapse using the files store's
  existing `isFolderCollapsed` / `expandFolder` / `collapseFolder`.
- Documents: `md` rows navigate to `{ name: 'reader-document', params: { entryId: id } }`.
  `image` rows also navigate (see ReaderDocument). `pdf`/`web` rows render at reduced
  opacity and still navigate (they get the placeholder screen).
- Row height ≥ 44px, full-row tap area, `active:bg-surface-elevated` feedback (no hover
  states as the primary affordance).
- Loading state: centered spinner while `filesStore.loading`; empty state mirrors the
  desktop copy ("Open a note to begin" style, `font-display`).

**`ReaderDocument.vue`** — one rendered note.

- Props: `entryId: string`. Look up the entry with `filesStore.getEntry(entryId)`;
  if missing (bad URL), show a "Note not found" state with a back link.
- Content loading: `filesStore.getCached(entryId)` first, else `await
  filesStore.downloadContent(entryId)` with a skeleton in between. Re-run on `entryId`
  change (`watch` with `immediate: true` — the component is reused across
  `/read/a → /read/b` navigations).
- `md`: render via `parseMarkdownWithToc(content, filesStore.getImageUrl)`, `v-html` into
  `<article class="markdown-body …">`. Import `katex/dist/katex.min.css` and
  `@/assets/markdown-body.css` here.
- Reading layout: scroll container `overflow-y-auto`; article `max-w-[70ch] mx-auto
  px-5 py-6 font-preview text-text-primary`, `font-size: 16px`, `line-height: 1.7`,
  `pb-[env(safe-area-inset-bottom)]`. No card/box-shadow chrome — the page *is* the
  canvas (`bg-bg`).
- `image`: render `<img :src="filesStore.getImageUrl(entryId)">` full-width.
- `pdf` / `web`: centered placeholder — muted icon, "PDFs open in the desktop app",
  back button.
- TOC scroll: expose a `scrollToHeading(id)` method (via `defineExpose` or an event from
  the shell) that does `container.querySelector('#' + CSS.escape(id))?.scrollIntoView({
  behavior: 'smooth', block: 'start' })`. Give headings `scroll-margin-top` equal to the
  app-bar height so they don't hide under it.
- Word count footer: same as desktop preview (count words in the raw source).

**`ReaderTocSheet.vue`** — bottom sheet.

- Props: `toc: TocItem[]`, `open: boolean`; emits `select(id)` and `close`.
- Implementation: fixed-position overlay (`bg-black/30` scrim, tap to close) + a panel
  anchored to the bottom (`bg-surface rounded-t-2xl border-t border-border`,
  `max-h-[60dvh] overflow-y-auto`, drag-handle bar centered at top). Simple
  `transition` slide-up; **no gesture library, no new dependencies**.
- Items indented by `(depth - 1) * 16px`, 44px tall, `text-text-secondary` with
  depth-1 items `text-text-primary font-medium`. Tap → emit `select`, parent scrolls and
  closes the sheet.

### 3.6 What preview mode reuses vs. avoids

| Reuses as-is | Never touches |
| --- | --- |
| `files` store (tree, content cache, collapse state, `getImageUrl`) | `editor` store (tabs, dirty state, save timers) |
| `parseMarkdown` pipeline + KaTeX + admonitions | `TextEditor.vue` / CodeMirror |
| Design tokens + dark mode via `ui.isDarkMode` | Sidebar components (`FileExplorer*`, drag-drop composables) |
| Auth guard + `auth` store | `QuickSwitcher.vue` (desktop-keyboard-shaped; E3 builds a touch one) |

---

## 4. Phased implementation plan

Run `yarn type-check` and `yarn lint` after every phase. There is no test suite except
`src/lib/*.test.ts` — keep those green and extend `markdown.test.ts` in Phase 1.

**Phase 1 — Markdown groundwork.** Heading id slugs + `parseMarkdownWithToc` + tests
(§3.4). Extract `src/assets/markdown-body.css` and re-import it in `MarkdownPreview.vue`
(§3.3). ✅ *Accept when:* desktop preview looks unchanged; headings in the rendered
desktop preview now carry `id` attributes; new tests pass.

**Phase 2 — Routes + document view.** Router changes (§3.2), `ReaderShell` app bar,
`ReaderDocument` for `md`/`image`/placeholder types. Hardcode navigation by URL for now.
✅ *Accept when:* visiting `/read/<some-md-id>` renders the note beautifully at 375px
width (Chrome device toolbar), math/admonitions/images all render, dark mode follows the
desktop setting, unknown id shows the not-found state.

**Phase 3 — Browser view + redirect.** `ReaderBrowser` tree, folder expand/collapse,
navigation, loading/empty states, and the `< 768px` redirect from `/` (with `?desktop=1`
escape). ✅ *Accept when:* on a 375px viewport, loading `/` lands on `/read`; you can
browse folders and open notes; browser back returns to the tree with expansion state
intact; desktop `/` is unaffected at ≥ 768px.

**Phase 4 — TOC.** `ReaderTocSheet` wired to the shell's TOC button, smooth scroll with
`scroll-margin-top`, button hidden when `toc.length === 0`. ✅ *Accept when:* on a long
note, tapping a TOC entry scrolls to the right heading with the heading fully visible
below the app bar, and the sheet closes.

**Phase 5 — Polish.** Safe-area insets verified on a real phone (or iOS simulator),
active-state feedback on all tap targets, skeletons, 404/error states, truncation of long
note names in the app bar, `document.title` set to the note name on `reader-document`.

---

## 5. Extensions (explicitly out of v1 — do not build now)

- **E1 — "Edit" button:** app-bar action on `reader-document` that jumps to the desktop
  editor: navigate to `/?open=<entryId>&desktop=1`, and teach `AppShell.vue` (or a small
  composable in it) to call `editorStore.openEntry(id)` when an `open` query param is
  present, then strip it from the URL. Small, self-contained, ship any time after v1.
- **E2 — Inline mobile editing:** covered by `docs/features/mobile-editing.md`. The
  reader stays read-only; the mobile shell owns editing.
- **E3 — Search:** a full-screen search view reusing the `search` store / trigram index,
  opened from the browser app bar. Results tap through to `/read/:id`.
- **E4 — Reading niceties:** font-size stepper (persist via `ui` store's `syncRemote`
  pattern), "continue where you left off" (persist last `entryId` to localStorage),
  prev/next-note buttons at the document footer.

---

## 6. Open questions (resolve during build only if forced)

- **O1 — `visualViewport` quirks:** `h-dvh` should handle mobile URL-bar collapse; if an
  older WebView misbehaves, fall back to `100vh` + the existing overflow-hidden body.
- **O2 — Very large notes:** rendering is one synchronous `parseMarkdown` call, same as
  desktop; acceptable. If a specific note is slow on phone hardware, defer — do not add
  virtualization in v1.
- **O3 — Should `web` docs render their *notes* column in the reader?** They're markdown
  and would work through the same pipeline. Deferred: placeholder in v1 to keep scope; a
  natural fast-follow.
