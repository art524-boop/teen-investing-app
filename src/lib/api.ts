import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase'

export class ApiError extends Error {
  code: string
  status: number
  extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

/** A random id for this phone, used only to rate-limit wrong invite codes. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('deviceId')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('deviceId', id)
    }
    return id
  } catch {
    return ''
  }
}

/** Calls one of our Edge Functions. Errors come back as ApiError with a friendly message. */
export async function callFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token ?? SUPABASE_KEY}`,
  }
  const dev = deviceId()
  if (dev) headers['x-device-id'] = dev

  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'offline', 'Could not reach the server. Check your internet connection and try again.')
  }
  let json: Record<string, unknown> = {}
  try {
    json = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const { error, message, ...extra } = json
    throw new ApiError(res.status, String(error ?? 'error'), String(message ?? 'Something went wrong. Please try again.'), extra)
  }
  return json as T
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong. Please try again.'
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' })
