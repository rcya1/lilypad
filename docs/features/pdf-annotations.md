# PDF Annotations — Notes on PDFs

**Status:** Phases 1–4 implemented (2026-10-04); Phase 5 (area highlights, thumbnails, in-PDF search) not started. §0 went in as proposed; §0.1 lists where the build differs from the plan.
**Builds on:** [`web-annotations.md`](./web-annotations.md), which is shipped through Phase 4. Read it first: this doc reuses its notes pane, highlight store, reference syntax and leader line, and only describes what is different for PDFs.
**Related code:** `src/components/editor/PdfView.vue`, `AnnotatedDocPane.vue`, `HighlightToolbar.vue`, `HighlightPopover.vue`, `WebView.vue`, `WebNotesPane.vue`, `src/stores/annotations.ts`, `src/stores/files.ts`, `src/lib/pdfjs.ts`, `src/lib/pdfAnchor.ts`, `src/lib/pdfFetch.ts`, `src/components/sidebar/AddFromLinkModal.vue`, `api/fetch-pdf.ts`, `tools/fetch-pdf.mjs`

---

## 0. Proposed decisions

| #        | Decision                     | Proposal                                                                                                                                                                                                                      |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doc type | What a PDF note is           | One `pdf` entry. The PDF blob goes in Storage and the notes go in `entries.content`, the same shape as `web`. `'pdf'` already exists in `DocumentType` and in the DB check.                                                   |
| Render   | How the PDF is shown         | **`pdfjs-dist`** (pdf.js) with its `PDFViewer`: **all pages in one continuous vertical scroll**, canvas per page, a text layer and lazy page rendering. Not the browser's built-in viewer, which is a cross-origin black box. |
| Ingest   | Ways to get a PDF in         | **Upload** (button and drag-drop onto the sidebar) and **paste a link**. One "Add from link" modal sniffs the content type and sends the URL to the web capture or the PDF fetch.                                             |
| Fetch    | How link imports get the PDF | A Vercel function fetches the URL and **streams it straight into Storage** through a signed upload URL, which avoids Vercel's 4.5 MB response limit.                                                                          |
| Anchors  | Highlight storage            | The same `annotations` table, with a **PDF selector variant**: page index, text quote and position within that page, and **rects in PDF user-space** coordinates.                                                             |
| Visuals  | Highlight rendering          | **Absolutely positioned divs** in a per-page highlight layer, placed from the stored rects. Hover and click use point-in-rect hit-testing. No Custom Highlight API.                                                           |
| Notes    | Right pane                   | **Reuse `WebNotesPane`** as is. `WebDocPane` becomes a generic `AnnotatedDocPane` with a viewer slot.                                                                                                                         |
| Refs     | Notes → highlight            | **Same `[text](lily:hl-N)` syntax** and chips. No changes to the markdown side.                                                                                                                                               |

### 0.1 As built

- **Viewer selection is a prop, not a slot.** `AnnotatedDocPane` takes `type: 'web' | 'pdf'` and renders `WebView` or an async `PdfView` (so pdf.js and its CSS load only when a PDF opens) under one `ref="viewer"`. Both expose `highlightViewportRect(id): ViewerHighlightRect | null`.
- **pdf.js v6.** `isEvalSupported` and `PageViewport.convertToViewportRectangle` no longer exist: there is no eval path at all, and rects are converted corner by corner with `convertToViewportPoint`. `pdf_viewer.mjs` reads `globalThis.pdfjsLib` when it evaluates, so `src/lib/pdfjs.ts` loads the core first.
- **Assets.** A Vite plugin (`pdfjsAssetsPlugin`) serves `cmaps`, `standard_fonts`, `wasm` and `iccs` under `/pdfjs/` in dev and emits them into `dist/pdfjs/` on build. The service worker runtime-caches these, the worker, and opened PDFs (`lilypad-pdfs`, cleared on sign-out).
- **Link import buffers instead of streaming.** `tools/fetch-pdf.mjs` reads the body (capped at 50 MB, bailing after 1 KB if there's no `%PDF-` header), then PUTs it to the signed upload URL. The upload URL must be this project's `user-files` bucket (`VITE_SUPABASE_URL`, which the Vercel function reads at runtime), so the endpoint can't be used to PUT bytes anywhere else.
- **Add from link fallback.** If the PDF fetch errors for a URL that doesn't end in `.pdf`, the modal still tries web capture.
- **Position memory (from Phase 5).** Each PDF's last page, offset and zoom are kept for the session, so switching tabs returns to the same spot.

---

## 1. Vision

The web-annotations workflow, applied to PDFs such as papers, textbooks, slides and problem sets.

1. Upload a PDF, or paste a link to one (for example `https://arxiv.org/pdf/2401.01234`).
2. It opens with the PDF on the left and markdown notes on the right.
3. Select text to highlight it, give it a color and an inline note, and reference it from your notes with `[the key lemma](lily:hl-4)`.
4. Click a chip to scroll the PDF to that highlight. Click a highlight to jump to its note. Hover to see the leader line.

```
┌───────────┬───────────────────────────────┬───────────────────────────┐
│           │ Page [3] / 42   − 110% +   ⤢  │  Notes        [</>]       │
│  Sidebar  ├───────────────────────────────┤───────────────────────────┤
│  (files)  │  │ ...end of page 2        │ ▲│ ## Section 2              │
│           │  └─────────────────────────┘ ║│                           │
│           │  ┌─────── page 3 ──────────┐ ║│                           │
│           │  │ Lemma 2.1. ▓▓▓▓▓▓▓▓▓▓ ◄─┼─║┼─ See [the key lemma]      │
│           │  │ ...                     │ ║│   (lily:hl-4)             │
│           │  └─────────────────────────┘ ║│                           │
│           │  ┌─────── page 4 ──────────┐ ▼│                           │
└───────────┴───────────────────────────────┴───────────────────────────┘
```

The PDF is one **continuous vertical scroll** of all pages stacked with a small gap, like a browser
PDF viewer or Preview's continuous mode. You scroll freely across page boundaries and can see the
end of one page and the start of the next at once. The page number in the toolbar follows the
scroll position, and it is a jump-to box rather than a pager.

---

## 2. Goals and non-goals

### Goals

- PDFs become first-class entries in the file tree. Today `pdf` exists as a type, but those entries can't be opened.
- Faithful, crisp rendering (HiDPI) of large PDFs (300+ pages) without stalling the UI.
- Text highlights that stay put across zoom levels and reloads, with inline notes, `lily:` refs and the leader line, all with the same feel as web docs.
- Import from upload and from link.

### Non-goals for v1

- **Editing the PDF.** The file is never modified. Highlights live in our DB, not in the PDF.
- **Exporting highlights into the PDF** as real PDF annotations with `pdf-lib`. This is a followup (§12).
- **Importing existing annotations** made in other apps. pdf.js shows them read-only through its annotation layer, but they don't become Lilypad highlights.
- **OCR for scanned PDFs.** They have no text layer, so only area highlights (Phase 5) work on them.
- **Auth-gated links** (university proxies, paywalls). The server fetch has no session. The user can download the file and upload it instead.
- Dark-mode page inversion, offline caching of PDF blobs, and the mobile reader. All are followups.

---

## 3. User flows

1. **Upload:** the sidebar `+` menu gets "Upload PDF…" (a file picker), or the user drops a `.pdf` onto a folder in the tree. A progress toast appears, the entry shows up, and it opens.
2. **From link:** the existing web-page modal (`NewWebPageModal.vue`) becomes "Add from link". After the user pastes a URL, the server checks it:
   - **PDF** (by `Content-Type: application/pdf` or the `%PDF-` magic bytes) → fetched into Storage → `pdf` entry.
   - **Anything else** → the existing web capture → `web` entry.
   - Known landing-page patterns get rewritten first, for example `arxiv.org/abs/X` → `arxiv.org/pdf/X`. This is a small allowlist and can come later.
3. **Read:** all pages in one continuous scroll (mouse wheel, trackpad, scrollbar, PgUp/PgDn, Space), fit-to-width by default. There are no next/previous page buttons and no single-page mode in v1. The toolbar's page number updates as you scroll (the page occupying most of the viewport), and typing a number there jumps to that page. Zoom with buttons or ctrl+wheel; zooming keeps the point under the cursor in place. The PDF's own internal links (TOC, citations) scroll within the document, and external links open in a new tab.
4. **Highlight:** select text → the same floating toolbar as web (4 swatches + add note) → the highlight is created.
5. **Notes, refs, cross-linking:** identical to web docs.

Naming: a PDF entry keeps its `.pdf` extension (`Attention Is All You Need.pdf`). The tree shows it without the extension, and renaming can't change it. The rename change shipped alongside this doc enforces that. For link imports, the default name is the PDF's `Title` metadata, falling back to the URL's filename.

---

## 4. Rendering: pdf.js

### Options considered

- **Native viewer (`<iframe src=blob.pdf>`)** is free and has good fidelity, but its DOM is closed: we can't draw highlights, read selections or scroll to a spot. ❌
- **`pdfjs-dist` + `PDFViewer`** ⭐. pdf.js is the de facto standard (Firefox's viewer). `PDFViewer` from `pdfjs-dist/web/pdf_viewer.mjs` handles page layout, lazy rendering of visible pages, the text layer, the link layer, zoom and `scrollPageIntoView`. We skip the full `viewer.html` app and its toolbar and build our own toolbar from Tailwind and lucide.
- **PDFium compiled to WASM (EmbedPDF and similar)** is faster on huge files but newer and less proven, and its text-selection DOM differs. Worth revisiting if pdf.js performance turns out to be a problem. ❌ for v1.

### Integration notes

- **Lazy-load everything.** `pdfjs-dist` adds about 400 KB of main code plus a roughly 1 MB worker. Use `await import('pdfjs-dist')` inside `PdfView.vue` so the main bundle doesn't grow. Point `GlobalWorkerOptions.workerSrc` at the worker through Vite's `?url` import.
- **cMaps and standard fonts** have to be served for CJK and non-embedded fonts. Copy them from `node_modules/pdfjs-dist/{cmaps,standard_fonts}` into `dist` at build time (a small Vite plugin, or `vite-plugin-static-copy`) and set `cMapUrl` and `standardFontDataUrl`.
- **Loading:** `getDocument({ data })` with the blob from `supabase.storage.download()`. Use range requests through a signed URL (`getDocument({ url })`) instead if first paint on large files is slow. pdf.js supports range requests natively, and Supabase Storage serves them.
- **Container:** `PDFViewer` needs an absolutely positioned scroll container. That fits the left slot of the split pane.
- **Continuous scroll** is `PDFViewer`'s default (`ScrollMode.VERTICAL`, `SpreadMode.NONE`): every page gets a correctly sized placeholder `div` up front, so the scrollbar reflects the whole document, and only pages near the viewport render their canvas and text layer. The live page number comes from its `pagechanging` event. Don't use `PDFSinglePageViewer`, which shows one page at a time.
- **The worker means the viewer never blocks the main thread on parsing.** The leader line's rAF loop (web-annotations §8.2) stays cheap.

---

## 5. Anchoring highlights

PDFs are easier than web pages in one way and harder in another.

- **Easier:** the file is immutable, like the frozen snapshot, so anchors never drift. Every highlight also belongs to one page (or a few), which gives a cheap coarse anchor.
- **Harder:** pages render lazily. A highlight on page 200 has **no DOM** until that page scrolls into view, so we can't build a live `Range` up front the way `WebView` does. The text layer is also a set of absolutely positioned `<span>`s, not flowing text. Selections across columns or pages produce odd ranges, and the Custom Highlight API would paint jagged per-span boxes.

So for PDFs the **geometry** is the main thing we store, and the text is stored alongside it.

```ts
/** Existing web selector; rows without `kind` are read as 'web' (no data migration). */
interface WebSelectors {
  kind?: 'web'
  quote: { exact: string; prefix: string; suffix: string }
  position: { start: number; end: number }
}

interface PdfTextSelectors {
  kind: 'pdf-text'
  /** One entry per page the selection touches (usually one). */
  pages: {
    page: number // 0-based page index
    /** Quads in PDF user space (points, origin bottom-left, unscaled), so zoom-invariant. */
    rects: [x1: number, y1: number, x2: number, y2: number][]
  }[]
  /** For snippets in chips/popovers, search, and re-deriving rects if ever needed. */
  quote: { exact: string; prefix: string; suffix: string }
  /** Offsets into the start page's `getTextContent()` string. Exact, as the file is immutable. */
  position: { page: number; start: number; end: number }
}

/** Phase 5: rectangle "snip" for figures, equations and scanned pages. */
interface PdfAreaSelectors {
  kind: 'pdf-area'
  page: number
  rect: [x1: number, y1: number, x2: number, y2: number]
}

type HighlightSelectors = WebSelectors | PdfTextSelectors | PdfAreaSelectors
```

**Creating a highlight:** on `selectionchange` inside the viewer, take the selection `Range` → `range.getClientRects()` → group the rects by the page `div` they fall in → convert each to PDF space with that page's `viewport.convertToPdfPoint` → merge adjacent rects on the same line → store. The quote and position come from mapping the range ends back into the text layer's string, the same approach as `textAnchor.ts` but scoped to one page.

**Painting:** each rendered page gets a `pdf-highlight-layer` div between the canvas and the text layer. When pdf.js fires `pagerendered` (also on zoom), place one `<div>` per rect using `viewport.convertToViewportRectangle`, with `mix-blend-mode: multiply` so text stays readable. When a page is evicted, its layer goes with it. That is free virtualization.

**Hover and click:** the highlight layer stays `pointer-events: none` so text selection keeps working. On viewer `mousemove`, find the page under the pointer, convert to PDF space, and do a point-in-rect test against that page's highlights. That is a few dozen comparisons, much simpler than the caret hit-test web docs need.

**Scroll to a highlight:** `pdfViewer.scrollPageIntoView({ pageNumber, destArray: [null, {name: 'XYZ'}, x, y, null] })` using the first rect. This works even if the page has never rendered, which is the main reason to store geometry.

---

## 6. Data model

| Concern          | Where it lives                                        | Change                                                                                                   |
| ---------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| PDF bytes        | Storage `user-files/{user}/{id}.pdf` (`storage_path`) | Already the convention in `createDocument`                                                               |
| Notes (markdown) | `entries.content`                                     | Extend the `md`/`web` checks in `files.ts` (`uploadContent`, `contentMap` and trigram indexing) to `pdf` |
| Source metadata  | `entries.metadata` (jsonb, added for web)             | New `PdfDocMeta`, below                                                                                  |
| Highlights       | `annotations` table                                   | **No migration.** `selectors` is jsonb, so only the TS type widens (§5)                                  |
| Document type    | `document_type` check constraint                      | Already allows `'pdf'`                                                                                   |

```ts
interface PdfDocMeta {
  source: 'upload' | 'url'
  url?: string // final URL after redirects, for link imports
  originalFilename?: string
  title?: string // PDF Info/XMP title, if present
  pageCount: number
  importedAt: string
}
```

It looks like **no DB migration is needed**. That is worth confirming in Phase 0 (see O3 on Storage limits).

---

## 7. Architecture and components

```
AnnotatedDocPane.vue      ← generalized WebDocPane: split, divider, leader-line overlay
├─ <slot name="viewer">
│   ├─ WebView.vue        ← unchanged
│   └─ PdfView.vue        ← new: PDFViewer host + toolbar + highlight layers + selection toolbar
└─ WebNotesPane.vue       ← unchanged (rename to AnnotationNotesPane later, optional)
```

- **Viewer contract.** `WebDocPane` already calls `webView.highlightViewportRect(id)` for the leader line. Make that an explicit interface that both viewers `defineExpose`:
  ```ts
  interface AnnotationViewer {
    highlightViewportRect(
      id: string,
    ): { rect: DOMRect; band: { top: number; bottom: number } } | null
  }
  ```
  For PDFs, the result is `null` when the page isn't rendered, and the leader line already handles a missing endpoint.
- **Shared UI.** The selection toolbar (swatches + add note) and the inline note popover currently live inside `WebView.vue` (664 lines). Extract them into `HighlightToolbar.vue` and `HighlightPopover.vue` so `PdfView` reuses them instead of copying them. Do this as a refactor before the PDF highlight phase.
- **Store.** Generalize `useWebAnnotationsStore` into `useAnnotationsStore`. It is already keyed by `entryId`, its CRUD and `hl-*` sync ops don't care about selector shape, and `nextLocalId` / `findByLocalId` work unchanged. Only `HighlightSelectors` widens. Rename the file and keep a re-export alias during the transition.
- **`EditorPane.vue`** dispatches `type === 'pdf'` to `AnnotatedDocPane` with `PdfView`. **`FileExplorerNode.vue`** opens `pdf` like `web`, and its existing amber `File` icon can stay.
- **`files.ts`** gets `uploadPdf(file, parentId)` (the `uploadImage` pattern, plus `pageCount` and title read with pdf.js before upload), `importPdfFromUrl(url, parentId)` and `downloadPdf(entryId)` (returns `ArrayBuffer`).

---

## 8. Link import: `/api/fetch-pdf`

The obvious approach, the browser `fetch()`ing the PDF itself, fails for most hosts because PDFs are rarely served with CORS headers. Proxying through a Vercel function and returning the bytes **fails above 4.5 MB**, which is Vercel's response body limit, and many papers and textbooks are bigger than that.

**Flow:**

1. The client creates the entry id and asks Supabase for a **signed upload URL** for `{user}/{id}.pdf` (`storage.from('user-files').createSignedUploadUrl`). RLS has already checked that the path is the user's.
2. The client calls `POST /api/fetch-pdf { url, uploadUrl }`.
3. The function:
   - Runs the existing `assertCapturableUrl` SSRF guard from `tools/capture.mjs`: http(s) only, no private, loopback or metadata IPs. It **re-checks on every redirect**, so redirects are followed manually.
   - Fetches with a timeout and a byte cap (O2).
   - Checks the first 5 bytes for `%PDF-`, otherwise returns `{ notPdf: true }` so the client can fall back to web capture.
   - Streams the body to the signed upload URL.
   - Returns `{ finalUrl, size, filename }` (from `Content-Disposition` or the URL path).
4. The client loads the bytes from Storage, reads `pageCount` and the title with pdf.js, and inserts the entry row with its `metadata`. If the insert fails, it removes the blob, the same cleanup `createWebDocument` does.

"Add from link" calls `/api/fetch-pdf` first, because it is cheap and can bail out after the first bytes. On `notPdf` it falls through to `/api/capture`. Dev mirrors `devCapturePlugin` with a Vite middleware that runs the same handler module.

---

## 9. Security

- **pdf.js version ≥ 4.2.67** (CVE-2024-4367, arbitrary JS via a crafted font). Also set `isEvalSupported: false` as defense in depth.
- **No PDF JavaScript.** pdf.js doesn't run document JS by default. Keep `enableScripting: false`.
- **Links in the PDF:** use `PDFLinkService` with `externalLinkTarget: BLANK` and `rel=noopener noreferrer`. Allow only `http`, `https` and `mailto` schemes. In-document destinations scroll inside the viewer.
- **SSRF:** covered in §8. Reuse the guard and re-check after every redirect.
- **Uploads:** validate the `%PDF-` magic bytes client-side before uploading, and enforce the size cap. Storage RLS already isolates users' files.

---

## 10. Phased plan

**Phase 0 — Spike** (`experiments/pdf-spike/`). Confirm:

- `pdfjs-dist` + `PDFViewer` under Vite: worker, cMaps and fonts load from a production build.
- A 300-page textbook scrolls smoothly, and memory stays bounded as pages are evicted.
- Selection → PDF-space rects → repainted correctly at 50%, 100% and 200% zoom, and after a reload.
- `scrollPageIntoView` reaches a highlight on a page that has never rendered.
- The `/api/fetch-pdf` → signed-upload streaming path works on Vercel with a 30 MB PDF.
- Supabase Storage per-file limit and bucket MIME restrictions (O3).

**Phase 1 — Read-only PDF docs.** Upload (picker + drag-drop), `PdfView` as a continuous scroll of all pages with a toolbar (live page number / jump-to-page, zoom, fit width), open from the tree, `.pdf` naming. Notes don't exist yet.

**Phase 2 — Notes pane.** `WebDocPane` → `AnnotatedDocPane` with a viewer slot. PDF notes in `entries.content`, with `files.ts` content handling extended to `pdf`. Notes are searchable through the existing trigram index.

**Phase 3 — Link import.** `/api/fetch-pdf`, the "Add from link" modal with auto-detection, and arXiv `abs → pdf` rewriting.

**Phase 4 — Text highlights.** Extract `HighlightToolbar` and `HighlightPopover` from `WebView`, generalize the store, then add PDF selection → rects, highlight layers, point hit-testing, inline notes, `lily:` refs, scroll-to and the leader line through the `AnnotationViewer` contract.

**Phase 5 — Polish.** Area highlights (snip tool), page thumbnails or outline sidebar, in-PDF search (pdf.js `PDFFindController`), keyboard navigation, and restoring the last scroll position per document.

---

## 11. Open questions

- **O1 — Area highlights in v1?** For math-heavy PDFs, snipping an equation or figure may matter as much as text highlights. Phase 5 is the proposal, but they could move up to Phase 4. Area highlights need their own preview in the chip or popover, which is a rendered crop of the page.
- **O2 — Size cap.** Proposal: 50 MB, matching Supabase's default per-file limit. Large scanned textbooks exceed this. Raise the bucket limit, or reject with a clear message?
- **O3 — Storage bucket config.** Does `user-files` restrict MIME types or size? This needs checking in the Supabase dashboard. It is the one place a migration or config change might be needed.
- **O4 — Same PDF imported twice.** Store a SHA-256 in metadata to warn about duplicates? Cheap to add later.
- **O5 — Highlight colors on paper.** The web palette was tuned for arbitrary page backgrounds. On white paper, `multiply` blending with the same 4 colors probably works. Verify in Phase 4.
- **O6 — Notes pane for PDFs.** Keep the web pane's single rendered⇆code toggle (proposed, for consistency), or use the `.md` side-by-side?

---

## 12. Followups (out of scope)

- Export: write highlights into a copy of the PDF as real annotations (`pdf-lib`) for use in other readers.
- Import existing PDF annotations as Lilypad highlights.
- Offline: cache opened PDF blobs (Cache Storage or IndexedDB) and plug into the offline-sync model.
- Full-text search across PDF contents: extract text at import and store it in the trigram index.
- Mobile reader (`preview-mode.md`): `ReaderTreeNode` currently dims PDFs. A read-only `PdfView` there is cheap once Phase 1 lands.
- Dark mode: optional page inversion filter.
- Auth-gated links: the browser-extension path from web-annotations A4 would cover these too.
