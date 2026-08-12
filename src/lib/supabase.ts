import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// When unconfigured the app shows a setup screen instead of using this client.
export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'unconfigured',
)
