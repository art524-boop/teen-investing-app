import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // Shown in the console only; the app renders a friendly message (see App.tsx).
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.')
}

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_KEY || 'missing', {
  auth: {
    persistSession: true, // remembers who is signed in on this phone
    autoRefreshToken: true,
    detectSessionInUrl: true, // picks up the email-confirmation link
  },
})

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY)
