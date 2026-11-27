// Shared helpers for the Stage 1 Edge Functions.
// Never log request bodies, PINs, passwords, tokens or TEEN_PIN_SECRET.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2'

export const AVATARS = ['koala', 'kangaroo', 'turtle', 'owl', 'dolphin', 'fox', 'frog', 'sunflower'] as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Wraps a handler: CORS preflight, POST only, JSON body, errors as JSON. */
export function serve(handler: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Use POST.' })
    try {
      let body: Record<string, unknown> = {}
      try {
        const parsed = await req.json()
        if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
      } catch {
        throw new HttpError(400, 'bad_request', 'The request was not valid JSON.')
      }
      return await handler(req, body)
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, ...e.extra })
      console.error('Unexpected error:', e instanceof Error ? e.message : 'unknown')
      return json(500, { error: 'server_error', message: 'Something went wrong on our side. Please try again.' })
    }
  })
}

/** Service-role client: bypasses RLS. Server code only. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Anon client used only to sign a teen in and get a session for them. */
function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface ParentCaller {
  id: string
  familyId: string
}

/** The caller must be a signed-in parent who has passed two-step verification (aal2). */
export async function requireParent(req: Request): Promise<ParentCaller> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) throw new HttpError(401, 'not_signed_in', 'Please log in again.')
  const { data, error } = await adminClient().auth.getClaims(token)
  const claims = data?.claims as Record<string, unknown> | undefined
  if (error || !claims?.sub) throw new HttpError(401, 'not_signed_in', 'Please log in again.')
  const meta = (claims.app_metadata ?? {}) as Record<string, unknown>
  if (meta.role !== 'parent' || typeof meta.family_id !== 'string') {
    throw new HttpError(403, 'parents_only', 'Only a parent can do this.')
  }
  if (claims.aal !== 'aal2') {
    throw new HttpError(403, 'needs_two_step', 'Enter your authenticator code first.')
  }
  return { id: String(claims.sub), familyId: meta.family_id }
}

/** Finds a teen in the caller's family, or fails. */
export async function teenInFamily(admin: SupabaseClient, teenId: unknown, familyId: string) {
  if (typeof teenId !== 'string' || !/^[0-9a-f-]{36}$/i.test(teenId)) {
    throw new HttpError(400, 'bad_teen', 'That teen was not found.')
  }
  const { data, error } = await admin
    .from('teens')
    .select('id, family_id, nickname, username')
    .eq('id', teenId)
    .eq('family_id', familyId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'bad_teen', 'That teen was not found.')
  return data as { id: string; family_id: string; nickname: string; username: string | null }
}

// ---------------------------------------------------------------- PINs

export const PIN_RE = /^\d{6}$/
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/** Rejects PINs that are too easy to guess (all one digit, or a straight run). */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true
  const runs = ['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321', '543210']
  return runs.includes(pin)
}

export function checkNewPin(pin: unknown): string {
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
    throw new HttpError(400, 'bad_pin', 'The PIN must be exactly 6 digits.')
  }
  if (weakPin(pin)) {
    throw new HttpError(400, 'weak_pin', 'That PIN is too easy to guess. Try a less obvious one.')
  }
  return pin
}

/**
 * The teen's Supabase Auth password: HMAC-SHA256(TEEN_PIN_SECRET, "<teen_id>:<pin>").
 * The teen id is mixed in so the same PIN gives a different password for every teen.
 * Without the secret, the PIN alone cannot be used against Supabase Auth.
 */
export async function pinPassword(teenId: string, pin: string): Promise<string> {
  const secret = Deno.env.get('TEEN_PIN_SECRET')
  if (!secret || secret.length < 16) {
    console.error('TEEN_PIN_SECRET is missing or too short')
    throw new HttpError(500, 'server_not_ready', 'Teen logins are not set up yet. Please tell the app owner.')
  }
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${teenId}:${pin}`))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function teenEmail(teenId: string): string {
  return `${teenId}@teens.invalid`
}

export function randomHex(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Signs the teen in and returns the session (access + refresh token) for the phone. */
export async function signInTeen(teenId: string, pin: string) {
  const { data, error } = await anonClient().auth.signInWithPassword({
    email: teenEmail(teenId),
    password: await pinPassword(teenId, pin),
  })
  if (error || !data.session) return { session: null, status: error?.status ?? 400 }
  const s = data.session
  return {
    session: {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at,
    },
    status: 200,
  }
}

// ---------------------------------------------------------------- invites

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
export const INVITE_DAYS = 7

export function normaliseCode(code: unknown): string {
  return typeof code === 'string' ? code.toUpperCase().replace(/[\s-]/g, '') : ''
}

function newCode(): string {
  // 32 symbols divide 256 evenly, so taking the low 5 bits is unbiased.
  const a = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(a, (b) => CODE_ALPHABET[b & 31]).join('')
}

export async function createInvite(admin: SupabaseClient, teenId: string) {
  const expires = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  for (let i = 0; i < 6; i++) {
    const code = newCode()
    const { error } = await admin.from('invites').insert({ code, teen_id: teenId, expires_at: expires })
    if (!error) return { code, expires_at: expires }
    if (error.code !== '23505') throw error
  }
  throw new Error('Could not make a unique invite code')
}

// ---------------------------------------------------------------- audit log

export async function audit(
  admin: SupabaseClient,
  entry: { family_id: string; actor: string; action: string; amount?: number | null; details?: Record<string, unknown> },
) {
  const { error } = await admin.from('audit_log').insert({
    family_id: entry.family_id,
    actor: entry.actor,
    action: entry.action,
    amount: entry.amount ?? null,
    details: entry.details ?? {},
  })
  if (error) throw error
}

/** Client IP as seen by the Supabase gateway. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  return xff.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}
