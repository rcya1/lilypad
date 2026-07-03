// Frontend tree types for the file explorer — derived from DB rows in files store, not stored directly.

/**
 * Union type for any node in the file tree. Use `isDirectory()` to narrow.
 * These are in-memory view models built by the files store from flat DB rows;
 * they are NOT persisted to Supabase directly.
 */
export type Entry = Directory | Document

/** A folder node; children are built recursively from entries with matching parent_id. */
export interface Directory {
  kind: 'directory'
  id: string
  name: string
  parentId: string | null
  children: (Directory | Document)[]
}

export type DocumentType = 'pdf' | 'md' | 'image' | 'web'

/** A leaf document node; no children. `type` mirrors the DB `document_type` column. */
export interface Document {
  kind: 'document'
  id: string
  name: string
  parentId: string | null
  type: DocumentType
}

/** Type guard that narrows Entry to Directory; use before accessing `.children`. */
export function isDirectory(entry: Entry): entry is Directory {
  return entry.kind === 'directory'
}
