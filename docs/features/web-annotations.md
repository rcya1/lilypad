# Web Annotations — Notes on Websites

**Status:** Draft / RFC — core decisions locked (see §0), details pending
**Author:** (design doc, pre-implementation)
**Related code:** `src/stores/editor.ts`, `src/components/editor/EditorPane.vue`, `src/stores/files.ts`, `src/types/file-explorer.ts`

---

## 0. Decisions locked

| # | Decision | Choice |
| --- | --- | --- |
| Render | How the page is shown | **Frozen single-file snapshot** in a sandboxed same-origin iframe (reader-mode cut from scope — see §2 / followups) |
| Static | Snapshot is read-only (no live JS/forms/video) | **Accepted** — this is what makes anchoring reliable |
| Capture | Where capture runs | **Vercel serverless + headless Chromium** (Playwright / `@sparticuz/chromium`); public pages only for v1 |
| Notes pane | Right-pane shape | **Single pane, one toggle** rendered ⇆ code (not a nested editor+preview split) |
| Anchors | Highlight storage | **Relational `annotations` table** (Postgres + RLS), not a sidecar JSON file |
| Visuals | Highlight rendering | **CSS Custom Highlight API** (no DOM mutation, clean overlaps) **+ a caret hit-test layer** for hover/click, since the API is paint-only (spike-validated) |
| Refs | Notes → highlight syntax | **Markdown link `[text](lily:hl-3)`**, special-cased in the existing `marked` pipeline |
| Re-capture | Changed-page re-anchoring | **Deferred** — v1 captures once; no re-capture/re-anchor flow yet |

---

## 1. Vision

A new document type that lets you take notes _on a website_. You paste a URL, Lilypad
captures/renders that page in a left pane, and a notes pane on the right is bound to it.
You can:

- **Highlight and annotate** spans of the page. Inline notes appear when you hover a highlight.
- Write **document-level notes** (a normal markdown note for the whole page) in the right pane.
- **Cross-link** the two directions:
  - Click a highlight in the page → jump to / focus the related note.
  - Click a **marker reference** inside the rendered notes → the page pane scrolls to that highlight.
- Optionally **scroll-sync**: as the page scrolls, the notes pane tracks the nearest anchored note (and vice versa).

The notes pane intentionally differs from the existing `.md` editor: instead of a
side-by-side editor+preview split, it is a **single pane with one toggle** between
_rendered_ and _source (code)_. The left pane is already "the other half" of the split,
so a second internal split would be too busy.

### Target layout

```
┌───────────┬──────────────────────────────┬───────────────────────────┐
│           │                              │  Notes        [</>  ⤢]    │  ← toggle: rendered / code
│  Sidebar  │     Webpage (captured)       ├───────────────────────────┤
│  (files)  │                              │                           │
│           │   ...highlighted span... ◄───┼── hover → tooltip note    │
│           │                              │   ## Overall notes        │
│           │                              │   The author argues …     │
│           │                              │  See [the claim](lily:hl-3)│  ← click → scroll page to hl-3
│           │                              │                           │
└───────────┴──────────────────────────────┴───────────────────────────┘
       left pane = web view              right pane = notes (rendered OR code)
```

---

## 2. Goals / Non-goals

### Goals

- First-class `web` document type that lives in the file tree like `md`/`pdf`/`image`.
- Reliable rendering of a captured page that **looks like the original** as much as is feasible.
- Stable highlights that survive reloads and (ideally) minor changes to the source page.
- Inline (anchored) notes on highlights + a document-level markdown note.
- Bidirectional linking between highlights and note references, with smooth scroll-to.
- Reuse existing infrastructure (split-pane, markdown compiler, editor store sync primitives, Supabase persistence) wherever possible.

### Non-goals (for v1)

- Re-rendering live, interactive web apps (SPAs that need their JS running). We capture a **static snapshot**.
- Collaborative / multi-user annotation, sharing, or public annotation layers.
- Annotating arbitrary cross-origin _live_ pages via iframe (technically blocked — see §4).
- Full-page editing of the captured site. The page is read-only; only the notes are editable.
- Annotating embedded video/canvas/PDF inside the page.
- **Reader mode** (Readability-extracted "clean view"). Cut from scope — the snapshot already
  delivers fidelity + stable anchoring, reader mode is a commodity, only works on article pages,
  and introduces a second anchor space (snapshot DOM ≠ reader DOM). See followups (§13).

---

## 3. User flows

1. **Create:** "New web note" → paste URL → Lilypad captures the page (spinner / optimistic tab, mirroring `openDocumentOptimistic`) → page renders in the left pane, empty notes on the right.
2. **Highlight:** select text in the page → a small floating toolbar appears (color + "add note"). Choosing a color creates a highlight; "add note" creates a highlight _and_ focuses an inline note editor.
3. **Inline note:** each highlight can carry a short markdown note. Hovering the highlight shows it in a tooltip/popover; clicking opens it for editing.
4. **Document note:** the right pane is a full markdown note for the whole page (the "overall notes" pane). Toggle between rendered and source with one button.
5. **Reference a highlight from notes:** while editing notes, an autocomplete (e.g. type `▸` or `@`) inserts a reference to an existing highlight. In rendered mode, clicking it scrolls the page pane to that highlight and pulses it.
6. **Reverse jump:** clicking a highlight in the page scrolls the notes pane to the first note that references it (or to its inline note).
7. **Scroll-sync (optional, toggle):** "follow" mode keeps the nearest anchored note aligned with the page scroll position.

---

## 4. Core challenge A — how do we render the page?

This is _the_ decision the whole feature hangs on. The constraint that breaks the naive
approach: **a live `<iframe src="https://othersite.com">` is mostly useless here.**

- Many sites send `X-Frame-Options: DENY/SAMEORIGIN` or CSP `frame-ancestors`, so they
  refuse to load in our iframe at all.
- Even when they load, the iframe is **cross-origin**, so we cannot read its DOM, inject a
  highlight layer, read scroll position, or anchor annotations. Everything this feature
  needs requires same-origin DOM access.

So we need the page content to be served such that _we_ control the document. Options:

### Option A1 — Server-side **frozen snapshot** (SingleFile-style) ⭐ recommended

A backend capture step loads the URL in a headless browser, lets it render, then serializes
the **fully-rendered DOM into one self-contained HTML file**: CSS inlined, images/fonts as
`data:` URIs, scripts stripped. (This is exactly what the [SingleFile](https://github.com/gildas-lou/SingleFile)
project / "Save Page As → Single File" does.) We store that blob in Supabase Storage.

We then render it in the left pane via a **sandboxed same-origin iframe** (`srcdoc` or a
`blob:` URL — both inherit our origin, so the parent can script into the iframe DOM to draw
highlights and read scroll position). Because scripts are stripped and the iframe is
sandboxed _without_ `allow-scripts`, the captured page can't run code — good for both
fidelity-stability and security.

- ✅ Looks like the original (full CSS/layout/images).
- ✅ Fully offline & deterministic: no sub-resource CORS, no network at view time.
- ✅ **Content never changes underneath highlights** → anchoring is rock-solid (§5).
- ✅ Same-origin DOM → full control for highlight/scroll/linking.
- ⚠️ Needs a headless-browser capture service (resolved §0: Vercel + `@sparticuz/chromium`) —
  the heaviest part of the build, and bound by Vercel's function size/timeout limits.
- ⚠️ Won't capture content behind auth/paywall (no user session server-side).
- ⚠️ Storage cost: a rich page snapshot can be 1–10 MB. Acceptable; images dominate.
- ⚠️ Legal/ToS: we're storing a copy of third-party content (private, per-user — low risk, but note it).

### Option A2 — Server-side **HTML proxy / rewriter**

Backend fetches the raw HTML, strips framing headers, rewrites relative URLs (either to
absolute, or routed back through our proxy), injects our annotation script, and serves it
from our origin so the iframe is same-origin.

- ✅ Lighter than a headless browser for simple, server-rendered pages.
- ❌ Breaks on JS-heavy / client-rendered sites (no JS execution → blank or broken page).
- ❌ Sub-resources still need proxying/CORS handling; fragile.
- ❌ Page can **change over time** → highlights drift or break (unless we also snapshot).
- ❌ Bigger ongoing attack surface / SSRF risk on the proxy endpoint.

### Option A3 — **Reader-mode extraction** (Mozilla Readability) — _cut from v1, see §2 / §13_

Extract just the main article content into clean HTML (or convert to markdown) with
[Readability](https://github.com/mozilla/readability), then render it in our _own_ styles.

- ✅ Tiny, stable, consistent typography, can be done client-side after a fetch.
- ✅ Great for the "I'm reading an article and want to annotate the prose" case.
- ❌ Loses the original look (user wants "proper styles") — and the snapshot already gives stable anchoring, so this no longer earns its keep on that front.
- ❌ Fails on non-article pages (docs, dashboards, landing pages, threads).
- ❌ Commodity (every browser/Pocket/Instapaper does it) and adds a second anchor space. **Deferred to a followup.**

### Option A4 — **Browser extension** capture

A companion extension snapshots the page _from the user's logged-in tab_ and ships it to Lilypad.

- ✅ Best fidelity; captures the exact rendered state, including auth-gated content.
- ❌ Large separate build + distribution + maintenance surface. Out of scope for v1; revisit later.

### Recommendation

**Ship A1 (frozen snapshot) as the only render path for v1**, because the stability it gives the
annotation layer is worth more than anything else here — it makes §5 easy and the UX
trustworthy. A3 (reader mode) is **cut from scope** (§2) and parked as a followup (§13). Treat A2
as a fallback only if the snapshot service proves too heavy, and A4 as a future fidelity upgrade.

> **Capture (resolved, O1):** a Vercel serverless function bundling `@sparticuz/chromium` +
> Playwright. Public pages only for v1; auth-gated content waits on the extension path (A4).

---

## 5. Core challenge B — how do highlights stay anchored?

A highlight is a range of text in the page. We must be able to **re-find that range** every
time the page is reopened, and ideally even if the underlying page changed slightly. The
established model is the **W3C Web Annotation Data Model**, storing several _selectors_ per
highlight and resolving them with fallbacks (this is what Hypothesis does):

- **TextQuoteSelector** — the exact quoted text + a prefix/suffix of surrounding context.
  Robust to DOM restructuring; re-found by text search. Primary anchor.
- **TextPositionSelector** — start/end character offsets in the page's text. Fast, but
  fragile if content shifts. Used to disambiguate and to speed up resolution.
- **RangeSelector / XPath** — container path + offsets. Fast exact path; first to break.

On load we try position/range first (cheap), fall back to fuzzy text-quote matching
(`apache-annotator` / `dom-anchor-text-quote` do exactly this). If nothing matches, the
highlight becomes **orphaned** — still listed in the notes, but shown as "couldn't locate on
page" rather than silently lost.

**Because the frozen snapshot (A1) is immutable**, anchoring is nearly trivial and essentially
never orphans. We should _still_ store text-quote selectors so a future re-capture/update of a
page (O4) can re-anchor old notes against the new snapshot.

Rendering the highlight visuals (decided, §0): the
[CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API)
paints matched ranges **without mutating the captured DOM** (no reflow) and handles the classic
overlapping-highlight case far better than `<mark>` wrapping. Its one tradeoff — highlights are
paint-only and receive no pointer events — is handled by the caret hit-test layer in §8.2.

---

## 6. Data model

### 6.1 Document type

Add `'web'` to `DocumentType` (`src/types/file-explorer.ts`) and to the DB enum in
`src/types/database.ts` (`document_type`). A `web` entry is a hybrid of the `md` and binary
patterns already in `files.ts`:

| Concern | Where it lives | Mirrors |
| --- | --- | --- |
| Document-level notes (markdown) | `entries.content` (DB column) | how `md` works today |
| Captured page snapshot (HTML blob) | Supabase Storage `{user}/{id}.html` | how `pdf`/`image` use `storage_path` |
| Highlights + inline notes (see §6.3) | relational `annotations` table | new |
| Source metadata (URL, capture time, title) | small JSON column on `entries` (or `web_docs` row) | new |

### 6.2 Source/metadata

Stored in a small JSON column on the `web` entry (or a dedicated `web_docs` row):

```ts
interface WebDocMeta {
  url: string                 // original URL
  capturedAt: string          // ISO timestamp
  title: string               // <title> at capture
  snapshotPath: string        // storage path of the frozen HTML
  faviconDataUri?: string
}
```

### 6.3 Highlights / annotations

```ts
interface Highlight {
  id: string                  // short, referenceable, e.g. "hl-3"
  color: HighlightColor       // maps to design tokens; default accent/amber family
  createdAt: string
  selectors: {
    quote: { exact: string; prefix: string; suffix: string }
    position?: { start: number; end: number }
    range?: { startPath: string; startOffset: number; endPath: string; endOffset: number }
  }
  note?: string               // inline markdown note for this highlight (optional)
}
```

**Storage: a relational `annotations` table** (decided). Columns roughly:
`id, entry_id, user_id, color, selectors jsonb, note text, created_at, updated_at`, with RLS
mirroring `entries`. This is queryable across pages (e.g. "all highlights everywhere",
future cross-document search) at the cost of a migration + policy work up front. The
`selectors` blob holds the text-quote/position/range data from §5; `note` is the inline
markdown note. Chosen over a sidecar JSON file so highlights are first-class, queryable rows
rather than an opaque blob.

The document-level markdown note references highlights **by `id`**, so highlight ids must be
stable and short.

---

## 7. Architecture & components

Reuse, don't reinvent. The existing `EditorPane.vue` split-pane (drag divider, swap, rotate,
collapsible preview) is exactly the left/right container we want — generalize it so the two
"slots" aren't hardcoded to `TextEditor` + `MarkdownPreview`.

```
WebDocPane.vue                     ← chooses layout for type==='web' (parallels EditorPane)
├─ WebView.vue                     ← left: sandboxed iframe of snapshot + highlight layer
│   ├─ useWebCapture()             ← request/poll capture; load snapshot blob into the iframe
│   ├─ useHighlightLayer()         ← paint highlights (Custom Highlight API) + caret hit-test,
│   │                                 selection toolbar, hover popovers/leader line, click→emit
│   └─ useAnchoring()              ← resolve/serialize selectors (apache-annotator)
└─ WebNotesPane.vue                ← right: single pane, toggle rendered ⇆ code
    ├─ TextEditor.vue (reused)     ← code mode (CodeMirror, already exists)
    └─ MarkdownPreview.vue (reused)← rendered mode, extended with highlight-ref handling
```

New store: **`useWebDocStore`** (or extend `editor`/`files`) holding, per open web doc:
highlights, capture status, render mode, and the active/hovered highlight id. The existing
`editor` store already models cross-pane intent (`scrollToLineRequest`, `setPreviewCursor`,
`focusedPane`) — we add the cross-pane analogues for web (`scrollToHighlightRequest`,
`activeHighlightId`) rather than inventing a parallel system.

---

## 8. Linking & scroll-sync mechanics

### 8.1 Notes → page (marker references)

In the markdown note, a highlight reference needs a syntax that (a) is easy to insert, (b)
degrades gracefully as plain text, (c) is easy to compile to a clickable element. Options:

- **Reuse link syntax with a custom scheme:** `[the core claim](lily:hl-3)`. Zero new parser
  work — `marked` already produces an anchor; we just special-case `href` starting with `lily:`
  in `MarkdownPreview`/`markdown.ts` to render a clickable chip and intercept the click. ⭐ recommended.
- **Custom inline token:** e.g. `▸hl-3` or `^[hl-3]`, added as a `marked` extension (the repo
  already has custom extensions — admonitions, KaTeX). More control over rendering, more work.
- **Wiki-style:** `[[hl-3]]`. Familiar, but collides if we later add note-to-note wikilinks.

Insertion UX: an autocomplete in the editor (trigger char) listing existing highlights by
their quoted text, inserting the chosen reference. Clicking the rendered chip dispatches
`scrollToHighlightRequest`, the `WebView` scrolls the iframe to that highlight and pulses it.

### 8.2 Page → notes (hover/click) — spike-validated

Because Custom Highlight API highlights are **paint-only** (not DOM elements, so no pointer
events), hover/click is detected with a **caret hit-test**: on iframe `mousemove`/`click`, take
the pointer coords → `caretPositionFromPoint` → test the resulting text position against each
highlight `Range`. The hovered/clicked highlight sets `activeHighlightId`.

- **Click → jump:** notes pane scrolls to (and flashes) the first reference to that id, or opens
  its inline note. Mirror of the existing preview→editor cursor sync.
- **Hover → connecting line:** a top-level `pointer-events:none` SVG overlay draws a Bézier
  "leader line" from the highlight to its note. The highlight endpoint is computed by adding the
  highlight's in-iframe `getBoundingClientRect()` to the iframe's offset in the parent
  (same-origin makes this readable), clamped to the iframe's visible band; redrawn on a single
  rAF coalescing both scroll sources (iframe + notes pane).

**Performance (validated, see `experiments/web-capture-spike/viewer-leaderline.html`):** worst
case of 50 natively-painted highlights + an active leader line redrawing every frame while
scrolling held ~144fps; under 4× CPU throttle, exactly 1 frame in 573 missed the 60fps budget and
none approached visible jank (CLS 0.00, no long-task insights). The math is cheap because highlight
painting stays native — the only per-frame JS is one leader-line redraw, and only while hovering.

### 8.3 Optional "follow" scroll-sync

A toggle that, on page scroll, finds the topmost visible highlight and scrolls the notes pane
to its reference/inline note (debounced; guard against feedback loops the same way the
editor/preview sync does). Off by default — explicit click-to-jump is the primary interaction;
follow mode is a power-user nicety.

---

## 9. Security considerations

- **Render captured HTML with scripts stripped** at capture time, and additionally sandbox the
  iframe **without `allow-scripts`** (defense in depth). Allow same-origin only enough to script
  _into_ it from the parent (note: `allow-same-origin` + no `allow-scripts` lets the parent
  read the DOM while the content itself stays inert).
- **Sanitize** snapshot HTML (DOMPurify) before storing/rendering — strip `<script>`,
  inline event handlers, `javascript:` URLs.
- **SSRF:** the capture endpoint takes a user-supplied URL → must block private/loopback/metadata
  IP ranges, enforce scheme allowlist (`http`/`https`), timeouts, and size caps.
- **Storage isolation:** snapshots are per-user under the existing Storage RLS (same as
  images/PDFs); the `annotations` table is guarded by row-level security keyed on `user_id`.
- **Inline notes are user markdown** → they already flow through the existing (trusted) markdown
  pipeline; keep highlight-ref hrefs on an allowlist (`lily:` only) so a note can't inject a
  `javascript:` link.

---

## 10. Phased implementation plan

**Phase 0 — Spike (de-risk the two hard parts). ✅ DONE — see `experiments/web-capture-spike/`.**
Stood up a throwaway Playwright capture + a `blob:`-iframe viewer. Results on a live Wikipedia
page:

- ✅ Headless Chromium produced a faithful 468 KB single static HTML file (inlined CSS + base-href
  images, scripts stripped); renders essentially identical to the original.
- ✅ The `blob:` iframe is **same-origin** (origin reported as `blob:`), so the parent can reach
  `iframe.contentDocument`.
- ✅ The **CSS Custom Highlight API works inside the iframe**, driven from the parent — verified
  visually (amber highlight painted over page text) and programmatically.
- ✅ **Text-quote re-anchoring** re-finds a saved quote and rebuilds a `Range` after a clean reload
  with no live ranges — the §5 model holds.

Conclusion: the architecture in §0 is sound; nothing here forces a rethink. The remaining capture
risk is purely fidelity/offline completeness (full resource inlining), which is Phase 1
engineering, not an unknown.

**Phase 1 — Static web doc.** `web` document type end-to-end: create-from-URL, capture, store
snapshot, render read-only in `WebView`, file-tree integration. No annotations yet.

**Phase 2 — Notes pane.** `WebNotesPane` with the single rendered/code toggle, persisted to
`entries.content`, reusing `TextEditor` + `MarkdownPreview`.

**Phase 3 — Highlights.** Selection toolbar, highlight creation, persistence (`annotations`
table), re-anchoring on load, caret hit-testing, hover popovers, inline notes.

**Phase 4 — Cross-linking.** `lily:hl-x` references, autocomplete insertion, click-to-scroll
both directions, the hover leader line, pulse/flash affordances.

**Phase 5 — Polish.** Follow-mode scroll-sync, orphaned-highlight UI, re-capture/update flow,
highlight colors tied to design tokens.

---

## 11. Open questions

Most original questions are now resolved in §0. Remaining / newly surfaced:

- **O1 — Capture infra (resolved):** Vercel serverless + headless Chromium. Sub-questions to
  settle at build time: cold-start budget, capture timeout/size caps, and which Chromium
  packaging (`@sparticuz/chromium`) fits Vercel's function size limit.
- **O4 — Re-capture semantics (deferred):** v1 captures once. When we add re-capture, decide
  how aggressively to re-anchor old highlights and how to present orphans.
- **O7 — Highlight colors:** how many colors, and how do they map to design tokens (accent/amber
  family) without clashing with arbitrary page backgrounds?
- **O8 — Auth-gated pages:** v1 is public-pages-only. A browser-extension capture path (A4)
  remains the eventual answer for logged-in/paywalled content — revisit post-v1.
- **O9 — Snapshot size/quota:** rich snapshots run 1–10 MB each; decide per-user storage
  budgeting and whether to downscale/strip large media at capture time.

---

## 12. Summary of recommendations

| Question | Recommendation |
| --- | --- |
| How to render the page | **Frozen single-file snapshot** (A1) in a sandboxed same-origin iframe (reader-mode cut — §13) |
| How to anchor highlights | W3C selectors (quote + position + range) via `apache-annotator`; trivially stable because the snapshot is immutable |
| Highlight visuals | CSS Custom Highlight API for paint + a caret hit-test layer for hover/click (spike-validated) |
| Notes pane | Reuse split-pane left/right; right pane is **single, toggleable** rendered⇆code (not a sub-split) |
| Reference syntax | Markdown links with a `lily:` scheme, special-cased in the existing `marked` pipeline |
| Data model | New `web` document type; markdown in `entries.content`, snapshot blob in Storage, highlights in a relational `annotations` table |
| Linking | Reuse the editor store's cross-pane sync pattern; add `scrollToHighlightRequest` / `activeHighlightId` |

---

## 13. Followups (parked, out of v1 scope)

- **Reader mode (Readability "clean view").** Cut from v1 (§2). Cheap to add later — client-side
  `@mozilla/readability` run on the already-captured snapshot DOM, no second capture or infra.
  **Revisit only if:** (a) snapshot storage cost (O9) becomes a real problem — a reader-only
  capture is a much smaller storage tier; or (b) usage skews heavily toward long-form articles.
  The hard part when it returns is **not** the extraction — it's that the reader DOM ≠ the snapshot
  DOM, so highlights live in a different anchor space. Design the snapshot↔reader anchor mapping
  (or make highlights view-specific) before building it.
- **Browser-extension capture (A4)** for auth-gated / paywalled pages (O8).
- **Re-capture & re-anchoring** of changed pages (O4).
