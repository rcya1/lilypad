-- Lilypad schema: everything the app needs in a fresh Supabase project.
--
-- Run once, either pasted into the dashboard's SQL editor or with
--   psql "$DATABASE_URL" -f supabase/schema.sql
-- Re-running is safe: tables are created only if missing, and functions, triggers and policies are
-- replaced.
--
-- OAuth providers (Google, GitHub) are not part of the database; enable them under
-- Authentication → Providers.

-- ---------------------------------------------------------------------------------------------
-- entries: the file tree. Directories and documents (md notes, PDFs, images, captured web pages).
-- ---------------------------------------------------------------------------------------------

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('directory', 'document')),
  name text not null,
  document_type text check (document_type in ('pdf', 'md', 'image', 'web')),
  -- Deleting a directory deletes everything under it.
  parent_id uuid references public.entries (id) on delete cascade,
  -- `<user id>/<file>` in the user-files bucket, for PDFs, images and web snapshots.
  storage_path text,
  -- Note text (md documents, and the notes pane of PDFs and web pages).
  content text,
  -- Source URL, title, capture/import time, page count, ... (see src/types/database.ts).
  metadata jsonb,
  -- Siblings are ordered by this; new items go between neighbours, so it's fractional.
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bumped on every update; offline sync uses it for compare-and-swap saves.
  version bigint not null default 0,
  constraint entries_check check (
    (kind = 'document' and document_type is not null)
    or (kind = 'directory' and document_type is null)
  )
);

create index if not exists entries_user_id_idx on public.entries (user_id);
create index if not exists entries_parent_id_idx on public.entries (parent_id);

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

alter table public.entries enable row level security;

drop policy if exists "entries: owner can read" on public.entries;
create policy "entries: owner can read" on public.entries
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "entries: owner can insert" on public.entries;
create policy "entries: owner can insert" on public.entries
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "entries: owner can update" on public.entries;
create policy "entries: owner can update" on public.entries
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "entries: owner can delete" on public.entries;
create policy "entries: owner can delete" on public.entries
  for delete to authenticated using (user_id = auth.uid());

-- Compare-and-swap save of a note's text. Runs as the caller, so RLS still applies.
--   ok = true:  saved; `version` is the new version.
--   ok = false: `version`/`content` are the server's current values (both null if the row is gone).
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

-- ---------------------------------------------------------------------------------------------
-- annotations: highlights on PDFs and web pages.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Short per-document id ("hl-3") that notes link to.
  local_id text not null,
  color text not null default 'amber' check (color in ('amber', 'green', 'blue', 'rose')),
  -- Where the highlight is: text quote + offsets, plus page rects for PDFs.
  selectors jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists annotations_entry_id_idx on public.annotations (entry_id);
create index if not exists annotations_user_id_idx on public.annotations (user_id);

alter table public.annotations enable row level security;

drop policy if exists "annotations: owner can read" on public.annotations;
create policy "annotations: owner can read" on public.annotations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "annotations: owner can insert" on public.annotations;
create policy "annotations: owner can insert" on public.annotations
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.entries e where e.id = entry_id and e.user_id = auth.uid())
  );

drop policy if exists "annotations: owner can update" on public.annotations;
create policy "annotations: owner can update" on public.annotations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "annotations: owner can delete" on public.annotations;
create policy "annotations: owner can delete" on public.annotations
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- user_settings: one JSON blob of preferences (theme, vim, ...) per user.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings: owner can read" on public.user_settings;
create policy "user_settings: owner can read" on public.user_settings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "user_settings: owner can insert" on public.user_settings;
create policy "user_settings: owner can insert" on public.user_settings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_settings: owner can update" on public.user_settings;
create policy "user_settings: owner can update" on public.user_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Storage: the user-files bucket. Every object lives under `<user id>/`.
--
-- The bucket is public-read because notes embed images by their public URL. Object names are
-- random UUIDs, so files can only be read by someone who already has the link. Writes are limited
-- to the owner's own folder.
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "user-files: owner can read" on storage.objects;
create policy "user-files: owner can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user-files: owner can upload" on storage.objects;
create policy "user-files: owner can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user-files: owner can update" on storage.objects;
create policy "user-files: owner can update" on storage.objects
  for update to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user-files: owner can delete" on storage.objects;
create policy "user-files: owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
