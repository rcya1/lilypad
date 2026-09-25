// Hand-maintained types for the Supabase schema.
/** Stored in `entries.metadata` for `document_type = 'web'` documents. */
export interface WebDocMeta {
  url: string
  /** ISO timestamp. */
  capturedAt: string
  /** Page <title> at capture time. */
  title: string
}

export type HighlightColor = 'amber' | 'green' | 'blue' | 'rose'

/**
 * Stored in `annotations.selectors`. The snapshot never changes, so `position` resolves exactly;
 * `quote` is kept for robustness.
 */
export interface HighlightSelectors {
  quote: { exact: string; prefix: string; suffix: string }
  position: { start: number; end: number }
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
          metadata: WebDocMeta | null
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
          metadata?: WebDocMeta | null
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
          metadata?: WebDocMeta | null
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
