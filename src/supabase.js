import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabasePublishableKey || supabaseUrl.includes('placeholder') || supabasePublishableKey === 'placeholder') {
  throw new Error('Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment variables.')
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'analytics-dashboard-auth',
    },
  },
)

export async function restoreSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null

  const { data, error } = await supabase.auth.refreshSession()
  return error ? session : data.session
}
