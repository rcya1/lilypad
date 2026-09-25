import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// The anon key is safe to ship (access is gated by Row Level Security); the service key is not.
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check your .env file (see README).',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
