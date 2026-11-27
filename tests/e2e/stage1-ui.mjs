// Stage 1 browser test: two emulated phones walk the whole Stage 1 loop through the UI.
//
// Needs a confirmed parent account with NO authenticator set up yet (see README.md), and:
//   APP_URL (default http://localhost:4173 — run `npm run build && npm run preview` first)
//   E2E_PASSWORD, E2E_PARENT_C
//   SHOTS (optional folder for screenshots)
// Run: node tests/e2e/stage1-ui.mjs
import { chromium, devices } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:4173'
const PW = process.env.E2E_PASSWORD
const EMAIL = process.env.E2E_PARENT_C
const SHOTS = process.env.SHOTS
if (!PW || !EMAIL) throw new Error('Set E2E_PASSWORD and E2E_PARENT_C')
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

function base32(s) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += abc.indexOf(c).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
function totp(secret) {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', base32(secret)).update(buf).digest()
  const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}

const results = []
const check = (ok, name, info = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && info ? `  -> ${info}` : ''}`)
}
/** Waits up to 10 s for something to appear (isVisible() alone doesn't wait). */
const seen = (locator) => locator.first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined
// PW_CHROMIUM: path to an already-installed Chromium, if Playwright's own download isn't there.
const browser = await chromium.launch({ proxy, executablePath: process.env.PW_CHROMIUM || undefined })
const parentCtx = await browser.newContext({ ...devices['iPhone 13'] })
const teenCtx = await browser.newContext({ ...devices['Pixel 7'] })
const p = await parentCtx.newPage()
const t = await teenCtx.newPage()

try {
  // ---------------- parent phone
  await p.goto(APP)
  check(await seen(p.getByText('Practice app').first()), 'start screen shows the practice banner')
  check(await seen(p.getByRole('button', { name: 'Feedback' })), 'feedback button on the start screen')
  await shot(p, '01-start')
  await p.getByRole('link', { name: /I'm a parent/ }).click()
  await p.getByLabel('Email').fill(EMAIL)
  await p.getByLabel('Password').fill(PW)
  await p.getByRole('button', { name: 'Log in' }).click()

  await p.getByRole('heading', { name: 'Set up two-step verification' }).waitFor()
  check(await seen(p.getByRole('img', { name: /QR code/ })), 'first log in shows the authenticator QR code')
  await shot(p, '02-authenticator-setup')
  const secret = (await p.locator('.secret').textContent()).trim()
  // Regression: a second copy of the set-up screen (another tab, or the email link opening
  // a new one) must not delete the set-up this screen is showing ("factor not found").
  const p2 = await parentCtx.newPage()
  await p2.goto(`${APP}/parent/two-step`)
  await p2.getByRole('img', { name: /QR code/ }).waitFor()
  await p2.close()
  await p.getByLabel(/6-digit code/).fill(totp(secret))
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: /^Hi Sam/ }).waitFor()
  check(true, 'authenticator code accepted, parent lands on Home')

  // Log out and back in: should ask for the code, not set-up again
  await p.getByRole('link', { name: 'Account' }).click()
  await p.getByRole('button', { name: 'Log out' }).click()
  await p.getByRole('link', { name: /I'm a parent/ }).click()
  await p.getByLabel('Email').fill(EMAIL)
  await p.getByLabel('Password').fill(PW)
  await p.getByRole('button', { name: 'Log in' }).click()
  await p.getByRole('heading', { name: 'Enter your code' }).waitFor()
  check(true, 'second log in asks for the authenticator code')
  await shot(p, '03-enter-code')
  // wait for a fresh 30-second window so the code isn't the one already used
  await p.waitForTimeout(31000 - (Date.now() % 30000))
  await p.getByLabel(/6-digit code/).fill(totp(secret))
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: /^Hi Sam/ }).waitFor()

  // Add a teen
  await p.getByRole('link', { name: 'Add a teen' }).click()
  await p.getByLabel('Nickname').fill('Zoe')
  await p.getByRole('button', { name: '15' }).click()
  await p.getByRole('button', { name: 'Owl' }).click()
  await p.getByRole('button', { name: /Add teen and get invite code/ }).click()
  check(await seen(p.getByRole('alert').filter({ hasText: 'tick the box' })), 'consent tick is required')
  await p.getByLabel(/parent or guardian/).check()
  await shot(p, '04-add-teen')
  await p.getByRole('button', { name: /Add teen and get invite code/ }).click()
  await p.getByRole('heading', { name: 'Zoe is added' }).waitFor()
  const code = (await p.locator('.code').textContent()).trim()
  check(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'invite code shown', code)
  check(await seen(p.getByRole('button', { name: 'Copy code' })) && await seen(p.getByText(/Expires/)), 'copy button and expiry shown')
  await shot(p, '05-invite-code')
  await p.getByRole('link', { name: 'Done' }).click()
  check(await seen(p.getByText('Not joined yet')), 'Home lists Zoe as not joined yet')

  // ---------------- teen phone
  await t.goto(APP)
  await t.getByRole('link', { name: /I'm a teen/ }).click()
  await t.getByLabel('Invite code').fill(code.toLowerCase())
  await shot(t, '06-teen-code')
  await t.getByRole('button', { name: 'Next' }).click()
  const username = `zoe_${Date.now().toString(36).slice(-5)}`
  await t.getByLabel('Username').fill(username)
  await t.getByRole('button', { name: 'Next' }).click()
  await t.getByLabel('PIN', { exact: true }).fill('123456')
  await t.getByLabel('Enter your PIN again').fill('123456')
  await t.getByRole('button', { name: 'Join' }).click()
  check(await seen(t.getByText('too easy to guess')), 'easy PIN rejected on the phone')
  await t.getByLabel('PIN', { exact: true }).fill('580274')
  await t.getByLabel('Enter your PIN again').fill('580274')
  await shot(t, '07-teen-pin')
  await t.getByRole('button', { name: 'Join' }).click()
  await t.getByRole('heading', { name: 'Hi Zoe' }).waitFor()
  check(await seen(t.getByText('E2E The Parkers').first()), 'teen lands on Garden with "Hi Zoe" and the family name')
  await shot(t, '08-garden')

  // Feedback from the teen
  await t.getByRole('button', { name: 'Feedback' }).click()
  await t.getByLabel('Your feedback').fill('E2E: the garden sprout is cute')
  await t.getByRole('button', { name: 'Send' }).click()
  check(await seen(t.getByText('Your feedback was sent')), 'feedback saves from the teen phone')
  await t.getByRole('button', { name: 'Close' }).click()

  // App remembers who is signed in
  await t.goto(APP)
  await t.getByRole('heading', { name: 'Hi Zoe' }).waitFor()
  check(true, 'reopening the app goes straight to the teen side')

  // Log out, wrong PIN x5 -> locked message
  await t.getByRole('button', { name: 'Log out' }).click()
  await t.getByRole('heading', { name: 'Welcome back' }).waitFor()
  for (let i = 0; i < 5; i++) {
    await t.getByLabel('Username').fill(username)
    await t.getByLabel('PIN').fill('111222')
    await t.getByRole('button', { name: 'Log in' }).click()
    await t.getByRole('alert').waitFor()
  }
  check(await seen(t.getByText('Try again in 15 minutes or ask your parent to reset your PIN')), '5 wrong PINs show the locked message')
  await shot(t, '09-locked')

  // Parent sees the lock, resets the PIN
  await p.reload()
  await p.getByText('Locked', { exact: true }).waitFor()
  check(true, 'parent Home shows the teen is locked')
  await p.getByRole('button', { name: 'Reset PIN' }).click()
  await p.getByLabel('New PIN').fill('926351')
  await p.getByLabel('Enter it again').fill('926351')
  await shot(p, '10-reset-pin')
  await p.getByRole('button', { name: 'Reset PIN' }).last().click()
  check(await seen(p.getByText(/old PIN no longer works/)), 'PIN reset confirmed')
  await p.getByRole('button', { name: 'Close' }).click()

  // Old PIN fails, new PIN works
  await t.getByLabel('Username').fill(username)
  await t.getByLabel('PIN').fill('580274')
  await t.getByRole('button', { name: 'Log in' }).click()
  await t.getByRole('alert').waitFor()
  check(await seen(t.getByText(/username or PIN isn.t right/)), 'old PIN no longer works')
  await t.getByLabel('Username').fill(username)
  await t.getByLabel('PIN').fill('926351')
  await t.getByRole('button', { name: 'Log in' }).click()
  await t.getByRole('heading', { name: 'Hi Zoe' }).waitFor()
  check(true, 'new PIN logs the teen in')

  // New invite code from Home
  await p.getByRole('button', { name: 'New invite code' }).click()
  await p.getByRole('heading', { name: 'New invite code' }).waitFor()
  check(/^[A-HJ-NP-Z2-9]{6}$/.test((await p.locator('dialog .code').textContent()).trim()), 'parent can make a new invite code')
  await shot(p, '11-new-invite')
  await p.getByRole('button', { name: 'Close' }).click()
  await shot(p, '12-parent-home')

  // Account: password change screen exists
  await p.getByRole('link', { name: 'Account' }).click()
  check(await seen(p.getByLabel('New password')), 'Account has change password')

  // PWA bits
  const manifest = await p.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]')?.getAttribute('href')
    return href ? (await fetch(href)).json() : null
  })
  check(manifest?.display === 'standalone' && manifest.icons?.some((i) => i.sizes === '512x512'), 'web app manifest is installable (standalone, 512px icon)')
  const sw = await p.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    return Boolean(reg)
  })
  check(sw, 'service worker is registered')
} catch (e) {
  check(false, 'browser flow crashed', e.message)
  await shot(p, 'zz-parent-error')
  await shot(t, 'zz-teen-error')
} finally {
  await browser.close()
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
