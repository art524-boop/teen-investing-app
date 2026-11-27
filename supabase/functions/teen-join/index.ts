// teen-join (no login needed)
// Takes an invite code, the chosen username and a 6-digit PIN. Checks the code is
// valid and unused, sets the auth password to HMAC(TEEN_PIN_SECRET, teen_id:PIN),
// marks the code used and returns a session.
//
// Rate limit: 10 wrong invite codes from the same device or IP within 15 minutes
// block further join attempts from that device / IP for 15 minutes.
import {
  CODE_RE, HttpError, USERNAME_RE, adminClient, audit, checkNewPin, clientIp, json, normaliseCode,
  pinPassword, serve, signInTeen,
} from '../_shared/common.ts'

const BAD_CODE = 'That code didn\'t work. Check it with your parent: codes work once and last 7 days.'

function blockedError(until: string): HttpError {
  return new HttpError(429, 'join_blocked',
    'Too many wrong codes. Please wait 15 minutes, then try again.', { retry_at: until })
}

serve(async (req, body) => {
  const admin = adminClient()

  const keys = [`ip:${clientIp(req)}`]
  const device = req.headers.get('x-device-id') ?? ''
  if (/^[0-9a-f-]{36}$/i.test(device)) keys.push(`dev:${device.toLowerCase()}`)

  const { data: blockedUntil, error: blockErr } = await admin.rpc('svc_join_blocked', { p_keys: keys })
  if (blockErr) throw blockErr
  if (blockedUntil) throw blockedError(String(blockedUntil))

  // Username and PIN problems are the teen's typing, not code guessing: they don't count.
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'bad_username', 'Usernames are 3 to 20 letters, numbers or underscores.')
  }
  const pin = checkNewPin(body.pin)

  const code = normaliseCode(body.code)
  const recordWrongCode = async () => {
    const { data: until, error } = await admin.rpc('svc_join_record_failure', { p_keys: keys })
    if (error) throw error
    if (until) throw blockedError(String(until))
    throw new HttpError(400, 'bad_code', BAD_CODE)
  }

  if (!CODE_RE.test(code)) return await recordWrongCode()

  const nowIso = new Date().toISOString()
  const { data: invite, error: invErr } = await admin
    .from('invites')
    .select('code, teen_id, expires_at, used_at')
    .eq('code', code)
    .maybeSingle()
  if (invErr) throw invErr
  if (!invite || invite.used_at || invite.expires_at <= nowIso) return await recordWrongCode()

  const teenId = invite.teen_id as string
  const { data: teen, error: teenErr } = await admin
    .from('teens').select('id, family_id').eq('id', teenId).single()
  if (teenErr) throw teenErr

  const { data: taken, error: takenErr } = await admin
    .from('teens').select('id').eq('username', username).neq('id', teenId).maybeSingle()
  if (takenErr) throw takenErr
  if (taken) throw new HttpError(409, 'username_taken', 'That username is taken. Try another one.')

  // Claim the code atomically so it can only ever be used once.
  const { data: claimed, error: claimErr } = await admin
    .from('invites')
    .update({ used_at: nowIso })
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('code')
  if (claimErr) throw claimErr
  if (!claimed || claimed.length === 0) return await recordWrongCode()

  const { error: nameErr } = await admin
    .from('teens')
    .update({ username, failed_pin_count: 0, locked_until: null })
    .eq('id', teenId)
  if (nameErr) {
    await admin.from('invites').update({ used_at: null }).eq('code', code) // give the code back
    if (nameErr.code === '23505') throw new HttpError(409, 'username_taken', 'That username is taken. Try another one.')
    throw nameErr
  }

  const { error: pwErr } = await admin.auth.admin.updateUserById(teenId, { password: await pinPassword(teenId, pin) })
  if (pwErr) throw pwErr

  // Joining again with a new code signs out any older session on another phone.
  const { error: revokeErr } = await admin.rpc('svc_revoke_sessions', { p_user: teenId })
  if (revokeErr) throw revokeErr

  const { session } = await signInTeen(teenId, pin)
  if (!session) throw new Error('Sign-in after join failed')

  await audit(admin, {
    family_id: teen.family_id, actor: teenId, action: 'teen_joined',
    details: { teen_id: teenId, username },
  })
  return json(200, { session })
})
