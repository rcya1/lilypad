// Supabase client singleton — typed against the app's Database schema and shared across all stores.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// Anon key is intentionally used here — all data access is gated by Row Level Security policies on
// the Supabase side. Service-role keys must never be shipped to the client.
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
