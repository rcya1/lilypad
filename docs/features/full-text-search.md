# Feature: Full-Text Search

> **Status: NOT DONE**
>
> Existing code on `main` (commented out):
>
> | File | State | Notes |
> |------|-------|-------|
> | `src/stores/search.ts` | Exists, unused | Needs full rewrite |
> | `src/components/sidebar/SearchPanel.vue` | Exists, unused | UI is mostly reusable |
> | `src/components/sidebar/LilypadSidebar.vue` | Search button commented out | Uncomment after rewrite |
> | `src/stores/files.ts` | `getCachedEntries()` exists | Remove after rewrite |

---

## Design Goal

Search across all notes without downloading all file contents to the client. The server
builds and maintains a compact search index as files are saved. The client downloads
this index (much smaller than the raw content), searches it locally for instant results,
and fetches content only for the few matched files (for snippet extraction). Files
already in the editor's memory cache are searched locally — results from both sources
are merged.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Supabase (server)                     │
│                                                         │
│  entries table ──► DB trigger on INSERT/UPDATE/DELETE    │
│                         │                               │
│                         ▼                               │
│                  PL/pgSQL function                      │
│                  extracts tokens from content            │
│                  writes to search_index table            │
│                                                         │
│  search_index table                                     │
│    file_id | tokens (text[]) | updated_at               │
└────────────────────────┬────────────────────────────────┘
                         │
              client downloads index
              (single query, ~100–300KB)
                         │
┌────────────────────────▼────────────────────────────────┐
│                    Client (browser)                      │
│                                                         │
│  ┌──────────────┐    ┌───────────────────┐              │
│  │ Server Index  │    │ Local Cache Search │              │
│  │ (downloaded)  │    │ (open/dirty files) │              │
│  │              │    │                   │              │
│  │ query against │    │ brute-force scan  │              │
│  │ token index   │    │ against in-memory │              │
│  │ → candidates  │    │ editor content    │              │
│  └──────┬───────┘    └────────┬──────────┘              │
│         │     merge & dedupe   │                         │
│         └──────────┬───────────┘                         │
│                    ▼                                     │
│           candidate file IDs                             │
│                    │                                     │
│         ┌──────────┴──────────┐                         │
│         │ in cache?           │ not in cache?            │
│         ▼                     ▼                         │
│    use cached content    fetch from Storage              │
│    for snippets          (1–3 files max)                 │
│         │                     │                         │
│         └──────────┬──────────┘                         │
│                    ▼                                     │
│              render results                              │
│         (persisted in IndexedDB)                         │
└─────────────────────────────────────────────────────────┘
```

---

## Server Side

### `content` column on `entries`

Add a `content text` column so that the trigger function has access to the text without
needing to read from Storage:

```sql
ALTER TABLE entries ADD COLUMN content text;
```

This column is written alongside Storage on every save (dual-write). It is **not**
included in the normal `fetchEntries()` SELECT — it exists only for the trigger to read.

### `search_index` table

Stores per-file search tokens built by the trigger. One row per file.

```sql
CREATE TABLE search_index (
  file_id    uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  tokens     text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_index_user ON search_index(user_id);
CREATE INDEX idx_search_index_updated ON search_index(user_id, updated_at);
```

**`tokens`** is an array of unique lowercase trigrams (3-character subsequences)
extracted from the file content. Trigrams are the key optimization — they enable fast
substring search via set intersection rather than brute-force scanning:
- Query `"eigenvalue"` is decomposed into trigrams `["eig", "ige", "gen", ...]`.
- For each trigram, look up the set of file IDs whose token array contains it.
- Intersect the sets → candidate files (typically 1–5 files).
- This is O(query_trigrams) set intersections — sub-millisecond, no scanning.

**Size estimate:** A typical 5KB markdown file has ~1000–1500 unique trigrams.
200 files × ~1500 trigrams × 3 chars = ~900KB raw. As a PostgreSQL `text[]`,
roughly 1.5MB. With gzip over HTTP (Supabase enables this by default), the
actual download is ~300–500KB — comparable to a single image.

### Database trigger

Fires on every INSERT, UPDATE, or DELETE on `entries` where `content` changes:

```sql
CREATE OR REPLACE FUNCTION update_search_index()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM search_index WHERE file_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Only index markdown documents with content
  IF NEW.kind != 'document' OR NEW.document_type != 'md' OR NEW.content IS NULL THEN
    DELETE FROM search_index WHERE file_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Extract unique lowercase trigrams (every 3-char subsequence)
  INSERT INTO search_index (file_id, user_id, tokens, updated_at)
  VALUES (
    NEW.id,
    NEW.user_id,
    (
      SELECT COALESCE(array_agg(DISTINCT trigram), '{}')
      FROM (
        SELECT substr(lower(NEW.content), i, 3) AS trigram
        FROM generate_series(1, greatest(length(NEW.content) - 2, 0)) AS i
      ) t
      WHERE length(trigram) = 3
    ),
    now()
  )
  ON CONFLICT (file_id) DO UPDATE SET
    tokens = EXCLUDED.tokens,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_search_index
  AFTER INSERT OR UPDATE OF content OR DELETE
  ON entries
  FOR EACH ROW
  EXECUTE FUNCTION update_search_index();
```

This runs synchronously on every save. For a typical markdown file (~5KB), extracting
words and upserting one row takes <10ms — negligible overhead on the save path.

### Migration (backfill)

For existing files, run a one-time backfill:

```sql
-- 1. Backfill content column from Storage (run as a script/edge function)
-- 2. Then trigger the index build for all existing files:
UPDATE entries SET content = content WHERE kind = 'document' AND document_type = 'md';
-- (The UPDATE triggers trg_update_search_index for each row)
```

### RLS

Add an RLS policy on `search_index`:

```sql
ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own search index"
  ON search_index FOR SELECT USING (user_id = auth.uid());
```

---

## Client Side

### Index download

On app load, after entries are fetched, download the search index in a single query:

```ts
// First load (no IndexedDB cache):
const { data } = await supabase
  .from('search_index')
  .select('file_id, tokens, updated_at')

// Incremental sync (have IndexedDB cache):
const { data } = await supabase
  .from('search_index')
  .select('file_id, tokens, updated_at')
  .gt('updated_at', lastSyncedAt)
```

**This is a single HTTP request.** The Supabase `.select()` returns all rows in one
response — there is no per-file round-trip. The client receives a single JSON array of
~200 objects, each containing a `file_id` and a `tokens` (trigram) array. The client
then iterates this array to build the inverted `trigramIndex` map in memory.

**Download size estimate:** 200 files × ~1500 unique trigrams × 3 chars = ~900KB raw.
With gzip (enabled by default on Supabase responses), ~300–500KB actual transfer.

### Index structure (in-memory)

```ts
// Built client-side from the downloaded per-file trigram arrays
interface SearchState {
  // Inverted index: trigram → set of file IDs containing that trigram
  trigramIndex: Map<string, Set<string>>
}
```

Built by iterating each file's token array and adding the file ID to each trigram's set.
CPU-only operation, <100ms for typical collection sizes.

### Search algorithm (two-source merge)

When the user types a query:

**Source 1 — Trigram index (covers all saved files):**

1. Lowercase the query, extract trigrams: `"eigenvalue"` → `["eig", "ige", "gen", "env", "nva", "val", "alu", "lue"]`.
2. For each trigram, look up the set of file IDs in `trigramIndex`.
3. Intersect all sets → candidate file IDs. This is the core trigram optimization:
   it narrows hundreds of files down to 1–5 candidates in sub-millisecond time.
4. Trigram intersection can produce false positives (a file contains all trigrams but
   not as a contiguous substring). The verification step (step 7) eliminates these.

**Source 2 — Local cache (covers dirty/open files):**

5. For each file in `editorStore.openDocuments`, do a direct case-insensitive `indexOf`
   on the raw content. This catches:
   - Unsaved edits not yet reflected in the server index.
   - Queries shorter than 3 characters (can't use trigram index).

**Merge:**

6. Combine candidates from both sources, deduplicate by file ID (prefer local cache
   version if the file is open, since it may have unsaved edits).
7. **Verify + extract snippets**: for each candidate, get the file content:
   - If content is in the editor cache → use it directly.
   - If not → fetch from Supabase Storage (single file download, typically 1–3 files).
   - Run case-insensitive `indexOf` on the content to confirm the match.
   - Extract line-level snippets (~80 chars centered on each match).
8. Discard false positives (files where the verification `indexOf` finds no match).
9. Return results capped at 50 total / 3 per file.

### IndexedDB persistence

Cache the downloaded index locally so subsequent sessions don't need a full download:

```
Database: lilypad-search
Object stores:
  file_trigrams: { fileId: string, trigrams: string[], updatedAt: string }
  meta:          { key: 'lastSyncedAt', value: string }
```

On load: read from IndexedDB → build in-memory `trigramIndex` → do incremental sync
query → update changed entries → persist back to IndexedDB.

---

## What Needs to Change

### Database (Supabase SQL)

1. `ALTER TABLE entries ADD COLUMN content text;`
2. Create `search_index` table (schema above).
3. Create `update_search_index()` trigger function.
4. Create trigger `trg_update_search_index`.
5. Add RLS policy on `search_index`.
6. Run backfill migration.

### `src/types/database.ts`

- Add `content: string | null` to the entries `Row`, `Insert`, `Update` types.
- Add a `SearchIndexRow` type:
  ```ts
  interface SearchIndexRow {
    file_id: string
    tokens: string[]
    updated_at: string
  }
  ```

### `src/stores/files.ts`

- **`fetchEntries()`**: unchanged — does NOT select `content`.
- **`uploadContent()`**: after Storage upload, also update the `content` column:
  ```ts
  await supabase.from('entries').update({ content }).eq('id', entryId)
  ```
  (This fires the trigger, which updates `search_index` automatically.)
- **`createEntry()`**: include `content` in the insert payload.
- **`deleteEntry()`**: trigger handles `search_index` cleanup via `ON DELETE CASCADE`.
- Remove `getCachedEntries()`.

### `src/lib/search-index.ts` (new file)

Pure functions, no framework deps:

```ts
function extractTrigrams(text: string): string[]

function buildTrigramIndex(
  fileTokens: Map<string, string[]>
): Map<string, Set<string>>

function findCandidates(
  query: string,
  trigramIndex: Map<string, Set<string>>
): string[]  // candidate file IDs via trigram intersection

function searchContent(
  query: string,
  content: string,
  fileId: string,
  fileName: string,
  folderPath: string,
  maxPerFile: number
): SearchResult[]  // verified results with snippets
```

### `src/lib/search-db.ts` (new file)

IndexedDB persistence:

```ts
async function loadFileTrigrams(): Promise<Map<string, { trigrams: string[], updatedAt: string }>>
async function saveFileTrigrams(entries: { fileId: string, trigrams: string[], updatedAt: string }[]): Promise<void>
async function removeFileTrigrams(fileId: string): Promise<void>
async function getLastSyncedAt(): Promise<string | null>
async function setLastSyncedAt(ts: string): Promise<void>
async function clearAll(): Promise<void>
```

### `src/stores/search.ts` (rewrite)

**State:**
- `query`, `results`, `isOpen`, `isSearching`, `indexStatus` (same as before).

**Internal:**
- `trigramIndex: Map<string, Set<string>>` — inverted trigram→fileIds map.

**Actions:**
- `initIndex()` — load from IndexedDB, do incremental sync via Supabase query, rebuild
  `trigramIndex`.
- `search(q)` — debounce 200ms. Run against `wordIndex` for candidates, search
  `editorStore.openDocuments` directly for dirty files, merge, fetch content for
  candidates not in cache, extract snippets.
- `openResult(result)` — open file and scroll to line.

### `src/stores/editor.ts`

No changes needed — the local cache search in `search.ts` reads directly from
`editorStore.openDocuments`.

### `src/components/sidebar/SearchPanel.vue`

- Show "Building search index…" while `indexStatus !== 'ready'`.
- Change min query length hint to 3 characters (trigram minimum).
- Rest of UI (grouped results, snippets, etc.) is reusable as-is.

### `src/components/sidebar/LilypadSidebar.vue`

- Uncomment `SearchPanel`, `useSearchStore`, search icon, `Ctrl+Shift+F`.

---

## Performance

| Operation | Cost | When |
|-----------|------|------|
| Full index download | 1 query, ~300–500KB gzipped | First session |
| Load from IndexedDB + build trigramIndex | ~100ms CPU, no network | Subsequent sessions |
| Incremental sync | 1 query, 0–5 rows | Each session after first |
| Search query (trigram intersection) | <1ms | Each debounced keystroke |
| Snippet content fetch (cache miss) | 1–3 Storage downloads | Only for uncached candidates |
| Trigger overhead on save | <10ms server-side | Every auto-save |

---

## Edge Cases

- **Query shorter than 3 characters**: can't decompose into trigrams. Fall back to local
  cache search only (scan `editorStore.openDocuments`). Show hint: "Type at least 3
  characters to search all files."
- **False positives from trigram intersection**: a file may contain all query trigrams
  but not as a contiguous substring. The verification `indexOf` on actual content
  eliminates these. Typically <5% false positive rate for queries ≥ 5 chars.
- **File just edited but not saved**: the local cache search scans dirty editor content
  directly — unsaved edits are always searchable.
- **File saved but trigger hasn't run yet**: triggers are synchronous in PostgreSQL —
  the `search_index` row is updated before the save response returns to the client.
  No lag.
- **User signs out**: call `searchDB.clearAll()` to wipe IndexedDB.
- **IndexedDB unavailable**: fall back to downloading the full index every session. No
  persistence, but search still works.
- **Content column not yet backfilled** (migration in progress): `search_index` rows
  won't exist for unprocessed files. Client shows results only for indexed files.
  Transparent to the user after migration completes.
- **Special characters in query**: trigrams include all characters (spaces, punctuation,
  etc.) since they're raw 3-char subsequences. A query like `O(n)` produces trigrams
  `["o(n", "(n)"]` and matches correctly. No tokenization issues.
