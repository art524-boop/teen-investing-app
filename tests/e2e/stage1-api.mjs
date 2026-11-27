// Stage 1 end-to-end test against the real Supabase project (no browser).
//
// Needs two confirmed, never-used parent accounts (see tests/e2e/README.md) and:
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY  (from .env)
//   E2E_PASSWORD, E2E_PARENT_A, E2E_PARENT_B
// Run: node --env-file=.env tests/e2e/stage1-api.mjs
import { createClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'node:crypto'

const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const PW = process.env.E2E_PASSWORD
const A = process.env.E2E_PARENT_A
const B = process.env.E2E_PARENT_B
if (!URL || !KEY || !PW || !A || !B) throw new Error('Missing env vars, see the header of this file')

const results = []
const check = (ok, name, info = '') => {
  results.push({ ok, name })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && info ? `  -> ${info}` : ''}`)
}

// ---- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) so the test can pass two-step verification
function base32(s) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += abc.indexOf(c).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
function totp(secret, t = Date.now()) {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(t / 30000)))
  const h = createHmac('sha1', base32(secret)).update(buf).digest()
  const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}

const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function fn(name, body, token, device) {
  const headers = { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${token ?? KEY}` }
  if (device) headers['x-device-id'] = device
  const r = await fetch(`${URL}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function parentWithTwoStep(email) {
  const c = client()
  const { error } = await c.auth.signInWithPassword({ email, password: PW })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  const aal1Token = (await c.auth.getSession()).data.session.access_token
  const { data: en, error: enErr } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `e2e-${Date.now()}` })
  if (enErr) throw new Error(`enroll: ${enErr.message}`)
  const { error: vErr } = await c.auth.mfa.challengeAndVerify({ factorId: en.id, code: totp(en.totp.secret) })
  if (vErr) throw new Error(`verify: ${vErr.message}`)
  const s = (await c.auth.getSession()).data.session
  return { c, token: s.access_token, aal1Token, secret: en.totp.secret, factorId: en.id, id: s.user.id }
}

const pa = await parentWithTwoStep(A)
const pb = await parentWithTwoStep(B)
check(true, 'both parents log in and pass two-step verification (TOTP)')

// ---- parent without two-step sees nothing and cannot create teens
{
  const c = client()
  await c.auth.signInWithPassword({ email: A, password: PW })
  const { data } = await c.from('families').select('id')
  check((data ?? []).length === 0, 'parent at password-only level (aal1) reads no family data')
  const r = await fn('create-teen', { nickname: 'X', age_band: 14, avatar: 'fox', consent: true }, (await c.auth.getSession()).data.session.access_token)
  check(r.status === 403 && r.body.error === 'needs_two_step', 'create-teen refuses a parent without two-step', JSON.stringify(r))
  // And a fresh log in must challenge the existing factor (next level aal2)
  const { data: lvl } = await c.auth.mfa.getAuthenticatorAssuranceLevel()
  check(lvl.currentLevel === 'aal1' && lvl.nextLevel === 'aal2', 'next log in asks for the authenticator code')
  const { error } = await c.auth.mfa.challengeAndVerify({ factorId: pa.factorId, code: totp(pa.secret) })
  check(!error, 'log back in with password + authenticator code', error?.message)
}

// ---- add teen
const noConsent = await fn('create-teen', { nickname: 'Mia', age_band: 14, avatar: 'koala', consent: false }, pa.token)
check(noConsent.status === 400 && noConsent.body.error === 'needs_consent', 'create-teen requires the consent tick')
const ct = await fn('create-teen', { nickname: 'Mia', age_band: 14, avatar: 'koala', consent: true }, pa.token)
check(ct.status === 200 && /^[A-HJ-NP-Z2-9]{6}$/.test(ct.body.invite?.code ?? ''), 'parent adds a teen and gets a 6-character invite code', JSON.stringify(ct))
const teenId = ct.body.teen.id
const days = (new Date(ct.body.invite.expires_at) - Date.now()) / 86400000
check(days > 6.9 && days <= 7.01, 'invite code expires in 7 days')

{
  const { data } = await pa.c.from('teens').select('id, nickname, consent_at, username')
  check(data.length === 1 && data[0].consent_at && data[0].username === null, 'teens row saved with consent date, not joined yet')
  const { data: b } = await pb.c.from('teens').select('id')
  check(b.length === 0, 'family B cannot see family A\'s teen')
  const r = await fn('reset-teen-pin', { teen_id: teenId, pin: '482913' }, pb.token)
  check(r.status === 404, 'family B cannot reset family A\'s teen PIN', JSON.stringify(r))
  const r2 = await fn('new-invite', { teen_id: teenId }, pb.token)
  check(r2.status === 404, 'family B cannot make invite codes for family A\'s teen', JSON.stringify(r2))
}

// ---- teen joins (with a unique device id so the rate-limit test below is isolated)
const device = randomUUID()
const USER = `e2e_mia_${Date.now().toString(36).slice(-5)}`
const PIN1 = '482913'
const PIN2 = '739164'
{
  const weak = await fn('teen-join', { code: ct.body.invite.code, username: USER, pin: '123456' }, null, device)
  check(weak.status === 400 && weak.body.error === 'weak_pin', 'teen-join rejects an easy PIN like 123456')
  const wrong = await fn('teen-join', { code: 'ZZZZZZ', username: USER, pin: PIN1 }, null, device)
  check(wrong.status === 400 && wrong.body.error === 'bad_code', 'teen-join rejects a wrong code')
  const j = await fn('teen-join', { code: ct.body.invite.code.toLowerCase(), username: USER, pin: PIN1 }, null, device)
  check(j.status === 200 && j.body.session?.access_token, 'teen joins with code + username + PIN and gets a session', JSON.stringify(j))
  const again = await fn('teen-join', { code: ct.body.invite.code, username: 'e2e_other', pin: PIN1 }, null, device)
  check(again.status === 400 && again.body.error === 'bad_code', 'an invite code works only once')

  const t = client()
  await t.auth.setSession(j.body.session)
  const { data: me } = await t.from('teens').select('nickname, username')
  check(me.length === 1 && me[0].nickname === 'Mia' && me[0].username === USER, 'teen reads their own row')
  const { data: fam } = await t.from('families').select('name')
  check(fam.length === 1 && fam[0].name === 'E2E Family A', 'teen reads their family name (for "Hi Mia" + family)')
  const { data: inv } = await t.from('invites').select('code')
  check(inv.length === 0, 'teen cannot read invite codes')
  const { error: upErr, data: up } = await t.from('teens').update({ show_real_values: true }).eq('id', teenId).select()
  check(!upErr ? up.length === 0 : true, 'teen cannot update their own row')
  const tTok = (await t.auth.getSession()).data.session.access_token
  const r = await fn('create-teen', { nickname: 'X', age_band: 14, avatar: 'fox', consent: true }, tTok)
  check(r.status === 403, 'a teen cannot call parent-only functions')
  const { error: fbErr } = await t.from('feedback').insert({ screen: 'e2e', text: 'Feedback from the e2e test' })
  check(!fbErr, 'teen can send feedback', fbErr?.message)
  const { error: fbRead } = await t.from('feedback').select('id')
  check(Boolean(fbRead), 'teen cannot read feedback')

  // PIN alone is useless against Supabase Auth directly
  const direct = await client().auth.signInWithPassword({ email: `${teenId}@teens.invalid`, password: PIN1 })
  check(Boolean(direct.error), 'the PIN alone cannot sign in to Supabase Auth directly')
}

// ---- teen log in, lockout
let oldRefresh
{
  const ok = await fn('teen-login', { username: USER, pin: PIN1 })
  check(ok.status === 200 && ok.body.session, 'teen logs in with username + PIN')
  oldRefresh = ok.body.session.refresh_token
  const unknown = await fn('teen-login', { username: 'e2e_nobody', pin: PIN1 })
  const wrong1 = await fn('teen-login', { username: USER, pin: '111222' })
  check(unknown.status === 401 && wrong1.status === 401 && unknown.body.message === wrong1.body.message,
    'unknown username and wrong PIN give the same message')
  for (let i = 0; i < 3; i++) await fn('teen-login', { username: USER, pin: '111222' })
  const fifth = await fn('teen-login', { username: USER, pin: '111222' })
  check(fifth.status === 423 && fifth.body.error === 'locked', '5th wrong PIN locks the account', JSON.stringify(fifth))
  const right = await fn('teen-login', { username: USER, pin: PIN1 })
  check(right.status === 423 && /15 minutes or ask your parent/.test(right.body.message), 'while locked, even the right PIN is refused with the clear message')
  const { data } = await pa.c.from('teens').select('locked_until').eq('id', teenId).single()
  const mins = (new Date(data.locked_until) - Date.now()) / 60000
  check(mins > 14 && mins <= 15.1, 'lock lasts 15 minutes', String(mins))
}

// ---- parent resets PIN: unlocks, old PIN stops working, old sessions end
{
  const weak = await fn('reset-teen-pin', { teen_id: teenId, pin: '000000' }, pa.token)
  check(weak.status === 400, 'reset rejects an easy PIN')
  const r = await fn('reset-teen-pin', { teen_id: teenId, pin: PIN2 }, pa.token)
  check(r.status === 200, 'parent resets the teen\'s PIN', JSON.stringify(r))
  const old = await fn('teen-login', { username: USER, pin: PIN1 })
  check(old.status === 401, 'old PIN stops working after reset', JSON.stringify(old))
  const neu = await fn('teen-login', { username: USER, pin: PIN2 })
  check(neu.status === 200, 'new PIN works (and the lock is cleared)', JSON.stringify(neu))
  const c = client()
  const { error } = await c.auth.refreshSession({ refresh_token: oldRefresh })
  check(Boolean(error), 'sessions from before the reset are signed out', error ? '' : 'refresh still worked')
}

// ---- new invite code: old unused code dies, new one works for re-joining
{
  const ct2 = await fn('create-teen', { nickname: 'Leo', age_band: 16, avatar: 'fox', consent: true }, pa.token)
  const n = await fn('new-invite', { teen_id: ct2.body.teen.id }, pa.token)
  check(n.status === 200 && n.body.invite.code !== ct2.body.invite.code, 'new invite code issued')
  const oldTry = await fn('teen-join', { code: ct2.body.invite.code, username: `${USER}_l`, pin: PIN1 }, null, randomUUID())
  check(oldTry.status === 400 && oldTry.body.error === 'bad_code', 'the previous unused code stops working')
  const taken = await fn('teen-join', { code: n.body.invite.code, username: USER, pin: PIN1 }, null, randomUUID())
  check(taken.status === 409 && taken.body.error === 'username_taken', 'usernames are unique (and the code is not used up)')
  const ok = await fn('teen-join', { code: n.body.invite.code, username: `${USER}_l`, pin: PIN1 }, null, randomUUID())
  check(ok.status === 200, 'the new code works', JSON.stringify(ok))
}

// ---- audit log
{
  const { data } = await pa.c.from('audit_log').select('action, actor, details').order('created_at')
  const actions = data.map((r) => r.action)
  for (const a of ['parent_signed_up', 'teen_added', 'consent_given', 'invite_created', 'teen_joined', 'pin_reset']) {
    check(actions.includes(a), `audit_log has "${a}"`, actions.join(','))
  }
  const { data: b } = await pb.c.from('audit_log').select('action')
  check(b.every((r) => r.action === 'parent_signed_up'), 'family B\'s audit log has none of family A\'s entries')
  const { error } = await pa.c.from('audit_log').update({ action: 'x' }).eq('action', 'pin_reset')
  check(Boolean(error), 'parent cannot edit the audit log')
}

// ---- teen-join rate limit (run last: it blocks this device and IP for 15 minutes)
{
  const dev = randomUUID()
  let last
  for (let i = 1; i <= 10; i++) last = await fn('teen-join', { code: 'ZZZZZ' + 'ABCDEFGHJK'[i - 1], username: 'e2e_rl', pin: PIN1 }, null, dev)
  check(last.status === 429 && last.body.error === 'join_blocked', '10 wrong invite codes in 15 minutes block the device/IP', JSON.stringify(last))
  const eleventh = await fn('teen-join', { code: 'ZZZZZZ', username: 'e2e_rl', pin: PIN1 }, null, dev)
  check(eleventh.status === 429, 'further join attempts are blocked')
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
