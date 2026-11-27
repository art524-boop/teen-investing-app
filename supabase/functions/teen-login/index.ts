// teen-login (no login needed)
// Username + 6-digit PIN. Each attempt is counted before the PIN is checked; the
// 5th wrong PIN locks the account for 15 minutes. Returns a session on success.
import { HttpError, PIN_RE, USERNAME_RE, adminClient, json, serve, signInTeen } from '../_shared/common.ts'

const WRONG = 'That username or PIN isn\'t right. After 5 wrong tries, your account locks for 15 minutes.'
const LOCKED = 'Try again in 15 minutes or ask your parent to reset your PIN.'

serve(async (_req, body) => {
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const pin = typeof body.pin === 'string' ? body.pin : ''
  if (!USERNAME_RE.test(username) || !PIN_RE.test(pin)) throw new HttpError(401, 'wrong', WRONG)

  const admin = adminClient()
  const { data: teen, error } = await admin
    .from('teens').select('id').eq('username', username).maybeSingle()
  if (error) throw error
  if (!teen) throw new HttpError(401, 'wrong', WRONG)

  const { data: attempt, error: attemptErr } = await admin.rpc('svc_pin_attempt_begin', { p_teen: teen.id })
  if (attemptErr) throw attemptErr
  const a = attempt as { ok: boolean; reason?: string; locked_until?: string; attempt?: number }
  if (!a.ok) {
    if (a.reason === 'locked') throw new HttpError(423, 'locked', LOCKED, { locked_until: a.locked_until })
    throw new HttpError(401, 'wrong', WRONG)
  }

  const { session, status } = await signInTeen(teen.id, pin)
  if (!session) {
    if (status === 429) {
      throw new HttpError(429, 'busy', 'Too many logins right now. Please wait a minute and try again.')
    }
    if ((a.attempt ?? 0) >= 5) throw new HttpError(423, 'locked', LOCKED)
    throw new HttpError(401, 'wrong', WRONG)
  }

  const { error: okErr } = await admin.rpc('svc_pin_attempt_success', { p_teen: teen.id })
  if (okErr) throw okErr
  return json(200, { session })
})
