# Installable app + offline sync

**Status:** Implemented. Needs the database migration below applied in Supabase for merge-safe
saves (until then, saves fall back to the old overwrite behaviour).

Lilypad installs as a PWA (Chrome/Edge desktop, Android; "Add to Home Screen" on iOS) and keeps
working offline: everything you've loaded is readable, notes and the file tree are editable, and
changes sync when you reconnect, with git-style merging when a note changed on another device too.

---

## Decisions

| Area                | Decision                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install             | `vite-plugin-pwa`: web manifest (name "Lilypad", standalone window, `start_url: /`, app green), precached app shell                                                                    |
| Offline scope       | Read **and** edit: note text, create / rename / move / delete files and folders, web-page highlights. Image uploads, new web captures and non-markdown file creation need a connection |
| Storage             | IndexedDB (`idb-keyval`, db `lilypad-offline`) for notes, tree, queue, merge bases, conflicts, highlights. Service-worker caches for media                                             |
| Media               | Only what you've opened: images (`lilypad-images`) and captured pages (`lilypad-pages`) are cached on first view                                                                       |
| Note sync           | Every save — online or offline — is a compare-and-swap against the version the edit was based on. Mismatch → line-based three-way merge (`node-diff3`)                                 |
| Conflicts           | Overlapping edits get git markers in the note with VS Code-style "Accept mine · Accept theirs · Accept both" links. A conflicted note stays local-only until its markers are gone      |
| Rename/move clashes | Latest change wins, per field                                                                                                                                                          |
| Edit vs delete      | Your offline edit wins: the note is restored (in its old folder, else at the top level)                                                                                                |
| Updates             | "Update available · Reload" prompt; nothing reloads under you                                                                                                                          |
| Status              | Pill in the sidebar footer (Offline · N pending / Syncing / N pending / N conflicts → click to open); conflicted notes get a ⚠ in the file tree                                        |
| Sign out            | Wipes this user's offline copy (IndexedDB + media caches), after a warning if anything is unsynced                                                                                     |
| Offline start       | If the session can't be refreshed offline, the app runs as the last signed-in user on their on-device copy                                                                             |

---

## Architecture

```
editor / tree / highlights ──► files store / webAnnotations store   (apply locally, persist snapshot)
                                          │
                                          ▼
                                     sync store  ── queue (IndexedDB) ──► Supabase
                                          │  content: save_entry_content (compare-and-swap)
                                          └─ mismatch → threeWayMerge(base, mine, theirs)
```

- **`src/lib/offline.ts`** — IndexedDB access, the `SyncOp` types and `enqueueOp` (folds ops so a
  long offline session stays small: one content push per note, updates merged per field, a delete
  cancels a pending create outright).
- **`src/stores/sync.ts`** — the queue, replay (`flush`, in order; stops at the first connection
  failure and retries on `online` / every 30s; ops the server _rejects_ are dropped with a toast so
  they can't block the queue), merge bases, conflicts, status.
- **`src/stores/files.ts`** — local-first CRUD; `fetchEntries` shows the on-device snapshot, flushes,
  then `refreshFromServer` (keeps local text for notes with unsynced edits, conflicts or unsaved
  typing; pushes newer server text into open editors).
- **`src/lib/merge.ts`** — `threeWayMerge`, `findConflicts`, `resolveConflict`.
- **`src/components/editor/cm/conflicts.ts`** — conflict decorations + accept links; the
  `externalEdit` annotation so sync-driven text changes don't count as typing.
- **Client-generated ids** — notes and folders now get `crypto.randomUUID()` ids on the device so
  they can be created offline.

**Merge base.** For each note the device keeps the server text + `version` it last agreed with.
A save sends the text with that version; the server writes only if it still matches. Otherwise it
returns its current text, which is merged with the local text against the base: different lines
merge cleanly (and are pushed), overlapping lines become a conflict block.

---

## Database migration (apply in the Supabase SQL editor)

```sql
-- 1. A version counter on entries, bumped by every update.
alter table public.entries add column if not exists version bigint not null default 0;

create or replace function public.bump_entry_version()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists entries_bump_version on public.entries;
create trigger entries_bump_version
  before update on public.entries
  for each row execute function public.bump_entry_version();

-- 2. Compare-and-swap save of a note's text. Runs as the caller, so RLS still applies.
--    ok = true: saved, `version` is the new version.
--    ok = false: `version`/`content` are the server's current values (both null if the row is gone).
create or replace function public.save_entry_content(
  p_id uuid,
  p_content text,
  p_expected_version bigint
)
returns table (ok boolean, version bigint, content text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  new_version bigint;
begin
  update entries e
     set content = p_content
   where e.id = p_id and e.version = p_expected_version
  returning e.version into new_version;

  if found then
    return query select true, new_version, null::text;
    return;
  end if;

  return query select false, e.version, e.content from entries e where e.id = p_id;
  if not found then
    return query select false, null::bigint, null::text;
  end if;
end
$$;

grant execute on function public.save_entry_content(uuid, text, bigint) to authenticated;
```

Until this is applied, the client detects the missing function and falls back to plain
overwrites (today's behaviour), logging a console warning.

---

## Testing checklist

1. **Install:** `yarn build && yarn preview`, open in Chrome → install icon in the address bar.
2. **Offline read:** load the app, then DevTools → Network → Offline; reload → notes still there.
3. **Offline edit:** edit a note, create/rename/move/delete files offline → footer shows
   "Offline · N pending"; go online → "Syncing" → pill disappears; changes are on the server.
4. **Clean merge:** edit line 1 on device A offline, line 10 on device B; reconnect A → both edits.
5. **Conflict:** edit the same line on both → markers + accept links on A, ⚠ in the tree, pill shows
   "1 conflict"; accept a side → note syncs.
6. **Edit vs delete:** edit a note offline on A, delete it on B, reconnect A → restored with a notice.
7. **Sign out** with pending changes → warning; after sign-out, IndexedDB `lilypad-offline` has no
   keys for that user.

## Known limitations

- Highlight short ids (`hl-3`) are assigned per device; two devices creating highlights on the same
  page offline can both produce the same `hl-n`. Rare; the notes' `lily:` links then point at the
  older one.
- Only images/pages you've opened are available offline.
- PDFs and other binary files are read-only offline (their saves go straight to Storage).
