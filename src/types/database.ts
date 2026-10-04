// Hand-maintained types for the Supabase schema.
/** Stored in `entries.metadata` for `document_type = 'web'` documents. */
export interface WebDocMeta {
  url: string
  /** ISO timestamp. */
  capturedAt: string
  /** Page <title> at capture time. */
  title: string
}

/** Stored in `entries.metadata` for `document_type = 'pdf'` documents. */
export interface PdfDocMeta {
  source: 'upload' | 'url'
  /** Final URL after redirects, for link imports. */
  url?: string
  originalFilename?: string
  /** The PDF's own Title, if it has one. */
  title?: string
  pageCount: number
  /** ISO timestamp. */
  importedAt: string
}

export type EntryMeta = WebDocMeta | PdfDocMeta

export type HighlightColor = 'amber' | 'green' | 'blue' | 'rose'

/**
 * Stored in `annotations.selectors` for web pages. The snapshot never changes, so `position`
 * resolves exactly; `quote` is kept for robustness. Older rows have no `kind`.
 */
export interface WebHighlightSelectors {
  kind?: 'web'
  quote: { exact: string; prefix: string; suffix: string }
  position: { start: number; end: number }
}

/** A rectangle in PDF user space (points, origin bottom-left, unscaled): x1, y1, x2, y2. */
export type PdfRect = [number, number, number, number]

/**
 * Stored in `annotations.selectors` for PDFs. Geometry is the anchor (pages render lazily, so there
 * is no DOM to resolve text against up front); the text is for labels and search.
 */
export interface PdfHighlightSelectors {
  kind: 'pdf-text'
  /** One entry per page the selection touches; `page` is 0-based. */
  pages: { page: number; rects: PdfRect[] }[]
  quote: { exact: string; prefix: string; suffix: string }
  /** Offsets into the start page's text layer. */
  position: { page: number; start: number; end: number }
}

export type HighlightSelectors = WebHighlightSelectors | PdfHighlightSelectors

export function isPdfSelectors(s: HighlightSelectors): s is PdfHighlightSelectors {
  return s.kind === 'pdf-text'
}

export interface Database {
  public: {
    Tables: {
      entries: {
        Row: {
          id: string
          user_id: string
          kind: 'directory' | 'document'
          name: string
          /** Null for directories. */
          document_type: 'pdf' | 'md' | 'image' | 'web' | null
          parent_id: string | null
          /** For image and web documents. */
          storage_path: string | null
          /** Note text, for md and web documents. */
          content: string | null
          /** Web documents only. */
          metadata: EntryMeta | null
          /** Siblings are ordered by this (fractional). */
          sort_order: number
          created_at: string
          updated_at: string
          /**
           * Bumped on every update, for sync's compare-and-swap. Absent until that migration is
           * applied (docs/features/offline-sync.md).
           */
          version?: number
        }
        Insert: {
          id?: string
          user_id: string
          kind: 'directory' | 'document'
          name: string
          document_type?: 'pdf' | 'md' | 'image' | 'web' | null
          parent_id?: string | null
          storage_path?: string | null
          content?: string | null
          metadata?: EntryMeta | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          kind?: 'directory' | 'document'
          name?: string
          document_type?: 'pdf' | 'md' | 'image' | 'web' | null
          parent_id?: string | null
          storage_path?: string | null
          content?: string | null
          metadata?: EntryMeta | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      annotations: {
        Row: {
          id: string
          entry_id: string
          user_id: string
          /** Short per-document reference id (e.g. "hl-3"), unique within an entry. */
          local_id: string
          color: HighlightColor
          selectors: HighlightSelectors
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entry_id: string
          user_id: string
          local_id: string
          color?: HighlightColor
          selectors: HighlightSelectors
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entry_id?: string
          user_id?: string
          local_id?: string
          color?: HighlightColor
          selectors?: HighlightSelectors
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          user_id: string
          settings: Record<string, unknown>
          updated_at: string
        }
        Insert: {
          user_id: string
          settings: Record<string, unknown>
          updated_at?: string
        }
        Update: {
          user_id?: string
          settings?: Record<string, unknown>
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      /**
       * Compare-and-swap save of a note's text. On a mismatch, returns the server's version and
       * content (both null if the row is gone).
       */
      save_entry_content: {
        Args: { p_id: string; p_content: string; p_expected_version: number }
        Returns: { ok: boolean; version: number | null; content: string | null }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type EntryRow = Database['public']['Tables']['entries']['Row']
export type EntryInsert = Database['public']['Tables']['entries']['Insert']
export type AnnotationRow = Database['public']['Tables']['annotations']['Row']
export type AnnotationInsert = Database['public']['Tables']['annotations']['Insert']
