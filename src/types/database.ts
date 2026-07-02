/** Stored in `entries.metadata` for `document_type = 'web'` documents. */
export interface WebDocMeta {
  /** Original URL the snapshot was captured from. */
  url: string
  /** ISO timestamp of capture. */
  capturedAt: string
  /** Page <title> at capture time. */
  title: string
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
          document_type: 'pdf' | 'md' | 'image' | 'web' | null
          parent_id: string | null
          storage_path: string | null
          content: string | null
          metadata: WebDocMeta | null
          sort_order: number
          created_at: string
          updated_at: string
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
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type EntryRow = Database['public']['Tables']['entries']['Row']
export type EntryInsert = Database['public']['Tables']['entries']['Insert']
