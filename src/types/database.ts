export interface Database {
  public: {
    Tables: {
      entries: {
        Row: {
          id: string
          user_id: string
          kind: 'directory' | 'document'
          name: string
          document_type: 'pdf' | 'md' | 'image' | null
          parent_id: string | null
          storage_path: string | null
          content: string | null
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          kind: 'directory' | 'document'
          name: string
          document_type?: 'pdf' | 'md' | 'image' | null
          parent_id?: string | null
          storage_path?: string | null
          content?: string | null
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          kind?: 'directory' | 'document'
          name?: string
          document_type?: 'pdf' | 'md' | 'image' | null
          parent_id?: string | null
          storage_path?: string | null
          content?: string | null
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
