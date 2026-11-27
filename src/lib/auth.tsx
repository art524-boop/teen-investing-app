import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'parent' | 'teen' | null

export interface AuthState {
  loading: boolean
  session: Session | null
  role: Role
  familyId: string | null
  /** Parent only: 'aal2' once the authenticator code has been entered this session. */
  aal: 'aal1' | 'aal2' | null
  /** Parent only: true if an authenticator app is already set up. */
  hasFactor: boolean
  refresh: () => Promise<void>
  /** Signs out, then reloads the app at `to` so no family data stays in memory. */
  signOut: (to: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function describe(session: Session | null) {
  const meta = (session?.user.app_metadata ?? {}) as Record<string, unknown>
  const role: Role = meta.role === 'parent' || meta.role === 'teen' ? meta.role : null
  const familyId = typeof meta.family_id === 'string' ? meta.family_id : null
  let aal: AuthState['aal'] = null
  let hasFactor = false
  if (session && role === 'parent') {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    aal = data?.currentLevel === 'aal2' ? 'aal2' : 'aal1'
    hasFactor = data?.nextLevel === 'aal2'
  }
  return { role, familyId, aal, hasFactor }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, 'refresh' | 'signOut'>>({
    loading: true, session: null, role: null, familyId: null, aal: null, hasFactor: false,
  })

  const load = async (session: Session | null) => {
    const d = await describe(session)
    setState({ loading: false, session, ...d })
    if (d.role) {
      try { localStorage.setItem('lastSide', d.role) } catch { /* private mode */ }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer: calling Supabase inside this callback can deadlock the auth lock.
      setTimeout(() => load(session), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const refresh = async () => {
    const { data } = await supabase.auth.getSession()
    await load(data.session)
  }

  const signOut = async (to: string) => {
    await supabase.auth.signOut()
    window.location.replace(to)
  }

  return <AuthContext.Provider value={{ ...state, refresh, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function lastSide(): Role {
  try {
    const v = localStorage.getItem('lastSide')
    return v === 'parent' || v === 'teen' ? v : null
  } catch {
    return null
  }
}
