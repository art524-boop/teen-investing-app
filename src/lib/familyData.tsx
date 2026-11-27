import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { errorText } from './api'

export type Proof = 'none' | 'note' | 'check-in'

export interface TeenLite {
  id: string
  nickname: string
  age_band: number
  avatar: string
  username: string | null
  locked_until: string | null
}
export interface Task {
  id: string
  teen_id: string
  title: string
  category: string
  credits: number
  repeats: 'none' | 'weekly'
  proof_type: Proof
  due_date: string | null
  status: 'open' | 'submitted' | 'done' | 'archived'
  reopen_at: string | null
  created_at: string
}
export interface Submission {
  id: string
  task_id: string
  teen_id: string
  note: string | null
  submitted_at: string
  decision: 'pending' | 'approved' | 'not_yet'
  reason: string | null
  credits_given: number | null
  decided_at: string | null
}
export interface Idea {
  id: string
  teen_id: string
  title: string
  credits_asked: number
  status: 'pending' | 'approved' | 'declined'
  final_title: string | null
  final_credits: number | null
  created_at: string
  decided_at: string | null
}
export interface Shoutout {
  id: string
  teen_id: string
  text: string
  status: 'pending' | 'approved' | 'not_yet'
  reason: string | null
  credits_given: number | null
  created_at: string
  decided_at: string | null
}
export interface LedgerRow {
  id: number
  teen_id: string
  change: number
  reason: string
  source_type: string
  created_at: string
}

interface FamilyData {
  loading: boolean
  error: string
  familyName: string
  parentName: string
  teens: TeenLite[]
  tasks: Task[]
  submissions: Submission[]
  ideas: Idea[]
  shoutouts: Shoutout[]
  ledger: LedgerRow[]
  balances: Record<string, number>
  /** Parent: items waiting for a decision. */
  pendingCount: number
  /** Teen: decisions made since they last opened Tasks. */
  newDecisions: number
  markDecisionsSeen: () => void
  reload: () => Promise<void>
}

const Ctx = createContext<FamilyData | null>(null)

const TABLES = ['tasks', 'task_submissions', 'task_ideas', 'shoutouts', 'credit_ledger'] as const

export const PROOF_LABEL: Record<Proof, string> = { none: 'No proof', note: 'Note', 'check-in': 'Parent check-in' }

/** Loads everything Stage 2 needs for the signed-in family and keeps it live. */
export function FamilyDataProvider({ children }: { children: ReactNode }) {
  const { session, role, familyId } = useAuth()
  const userId = session?.user.id ?? ''
  const [state, setState] = useState<Omit<FamilyData, 'reload' | 'markDecisionsSeen' | 'pendingCount' | 'newDecisions'>>({
    loading: true, error: '', familyName: '', parentName: '', teens: [], tasks: [], submissions: [],
    ideas: [], shoutouts: [], ledger: [], balances: {},
  })
  const seenKey = `seenDecisions:${userId}`
  const [seenAt, setSeenAt] = useState<string>(() => {
    try { return localStorage.getItem(seenKey) ?? new Date(0).toISOString() } catch { return new Date(0).toISOString() }
  })

  const load = useCallback(async () => {
    const [fam, teens, tasks, subs, ideas, shouts, ledger, bal] = await Promise.all([
      supabase.rpc('my_family').maybeSingle<{ family_name: string; parent_name: string }>(),
      supabase.from('teens').select('id, nickname, age_band, avatar, username, locked_until').order('created_at'),
      supabase.from('tasks').select('id, teen_id, title, category, credits, repeats, proof_type, due_date, status, reopen_at, created_at').order('created_at'),
      supabase.from('task_submissions').select('id, task_id, teen_id, note, submitted_at, decision, reason, credits_given, decided_at').order('submitted_at', { ascending: false }).limit(300),
      supabase.from('task_ideas').select('id, teen_id, title, credits_asked, status, final_title, final_credits, created_at, decided_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('shoutouts').select('id, teen_id, text, status, reason, credits_given, created_at, decided_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('credit_ledger').select('id, teen_id, change, reason, source_type, created_at').order('created_at', { ascending: false }).limit(200),
      supabase.from('teen_balances').select('teen_id, balance'),
    ])
    const err = fam.error ?? teens.error ?? tasks.error ?? subs.error ?? ideas.error ?? shouts.error ?? ledger.error ?? bal.error
    if (err) {
      setState((s) => ({ ...s, loading: false, error: errorText(err) }))
      return
    }
    const balances: Record<string, number> = {}
    for (const b of (bal.data ?? []) as { teen_id: string; balance: number }[]) balances[b.teen_id] = b.balance
    setState({
      loading: false,
      error: '',
      familyName: fam.data?.family_name ?? '',
      parentName: fam.data?.parent_name ?? 'your parent',
      teens: (teens.data ?? []) as TeenLite[],
      tasks: (tasks.data ?? []) as Task[],
      submissions: (subs.data ?? []) as Submission[],
      ideas: (ideas.data ?? []) as Idea[],
      shoutouts: (shouts.data ?? []) as Shoutout[],
      ledger: (ledger.data ?? []) as LedgerRow[],
      balances,
    })
  }, [])

  // Live sync: any change to the family's rows triggers a (debounced) reload.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!familyId || !role) return
    load()
    const schedule = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(load, 150)
    }
    let channel = supabase.channel(`family:${familyId}:${userId}`)
    for (const table of TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `family_id=eq.${familyId}` }, schedule)
    }
    channel.subscribe()
    // Phones drop sockets when asleep: catch up whenever the app comes back.
    const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', schedule)
    const safety = window.setInterval(schedule, 60000)
    return () => {
      window.clearTimeout(timer.current)
      window.clearInterval(safety)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', schedule)
      supabase.removeChannel(channel)
    }
  }, [familyId, role, userId, load])

  const pendingCount = useMemo(() => role !== 'parent' ? 0 :
    state.submissions.filter((s) => s.decision === 'pending').length
    + state.shoutouts.filter((s) => s.status === 'pending').length
    + state.ideas.filter((i) => i.status === 'pending').length,
  [role, state.submissions, state.shoutouts, state.ideas])

  const newDecisions = useMemo(() => role !== 'teen' ? 0 :
    [...state.submissions, ...state.shoutouts, ...state.ideas].filter((x) => x.decided_at && x.decided_at > seenAt).length,
  [role, state.submissions, state.shoutouts, state.ideas, seenAt])

  const markDecisionsSeen = useCallback(() => {
    const now = new Date().toISOString()
    setSeenAt(now)
    try { localStorage.setItem(seenKey, now) } catch { /* private mode */ }
  }, [seenKey])

  const value: FamilyData = { ...state, pendingCount, newDecisions, markDecisionsSeen, reload: load }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFamily(): FamilyData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFamily must be used inside FamilyDataProvider')
  return v
}

/** The newest submission for a task, if any. */
export function latestSubmission(subs: Submission[], taskId: string): Submission | undefined {
  return subs.find((s) => s.task_id === taskId) // list is newest first
}

export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' })

export const fmtDue = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
