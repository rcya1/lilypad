-- Web Annotations — Phase 1 schema change
-- Apply in the Supabase SQL editor (Dashboard → SQL). Safe to run once.
--
-- Adds the 'web' document type and a `metadata` JSONB column on `entries` for the
-- captured page's url / title / capture timestamp. Snapshot HTML goes to Storage
-- (storage_path, like images/PDFs); the document-level notes use the existing `content`
-- column (like .md). No `annotations` table yet — that arrives with Phase 3.

-- `document_type` is gated by TWO check constraints — both must allow 'web'.

-- 1a. Column-level type check.
alter table public.entries drop constraint if exists entries_document_type_check;
alter table public.entries
  add constraint entries_document_type_check
  check (document_type in ('pdf', 'md', 'image', 'web'));

-- 1b. Table-level shape check (documents need a valid type; directories have none).
alter table public.entries drop constraint if exists entries_check;
alter table public.entries
  add constraint entries_check
  check (
    (kind = 'document' and document_type = any (array['pdf', 'md', 'image', 'web']))
    or (kind = 'directory' and document_type is null)
  );

-- 2. Metadata column for web docs ({ url, title, capturedAt }).
alter table public.entries
  add column if not exists metadata jsonb;
