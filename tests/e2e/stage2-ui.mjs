// Stage 2 browser test: two emulated phones, live sync measured against the 5-second target.
//
// Needs a confirmed parent account with no authenticator yet (see README.md), and:
//   APP_URL (default http://localhost:4173), E2E_PASSWORD, E2E_PARENT_C
//   PW_CHROMIUM (optional), SHOTS (optional screenshot folder)
// Run: node tests/e2e/stage2-ui.mjs
import { chromium, devices } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { mkdirSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:4173'
const PW = process.env.E2E_PASSWORD
const EMAIL = process.env.E2E_PARENT_C
const SHOTS = process.env.SHOTS
const SYNC_MS = 5000
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
const timings = []
const check = (ok, name, info = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${!ok && info ? `  -> ${info}` : ''}`)
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 10000 }).catch(() => {}) }
const seen = (locator, timeout = 10000) => locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
/** Waits for something to appear on the OTHER phone without refreshing; records how long it took. */
async function synced(locator, name) {
  const t0 = Date.now()
  const ok = await seen(locator, SYNC_MS)
  const ms = Date.now() - t0
  timings.push(ms)
  check(ok, `${name} — live in ${ok ? (ms / 1000).toFixed(1) + ' s' : 'over 5 s'}`)
}

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined
const browser = await chromium.launch({ proxy, executablePath: process.env.PW_CHROMIUM || undefined })
const p = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage()
const t = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage()
const stamp = Date.now().toString(36).slice(-4)

try {
  // ---------------- set up: parent with authenticator, teen joined
  await p.goto(`${APP}/parent/login`)
  await p.getByLabel('Email').fill(EMAIL)
  await p.getByLabel('Password').fill(PW)
  await p.getByRole('button', { name: 'Log in' }).click()
  await p.getByRole('heading', { name: 'Set up two-step verification' }).waitFor()
  const secret = (await p.locator('.secret').textContent()).trim()
  await p.getByLabel(/6-digit code/).fill(totp(secret))
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('heading', { name: /^Hi Sam/ }).waitFor()
  await p.getByRole('link', { name: 'Add a teen' }).click()
  await p.getByLabel('Nickname').fill('Mia')
  await p.getByRole('button', { name: '14' }).click()
  await p.getByRole('button', { name: 'Koala' }).click()
  await p.getByLabel(/parent or guardian/).check()
  await p.getByRole('button', { name: /Add teen and get invite code/ }).click()
  const code = (await p.locator('.code').textContent()).trim()
  await p.getByRole('link', { name: 'Done' }).click()

  await t.goto(APP)
  await t.getByRole('link', { name: /I'm a teen/ }).click()
  await t.getByLabel('Invite code').fill(code)
  await t.getByRole('button', { name: 'Next' }).click()
  await t.getByLabel('Username').fill(`mia_${stamp}`)
  await t.getByRole('button', { name: 'Next' }).click()
  await t.getByLabel('PIN', { exact: true }).fill('580274')
  await t.getByLabel('Enter your PIN again').fill('580274')
  await t.getByRole('button', { name: 'Join' }).click()
  await t.getByRole('heading', { name: 'Hi Mia' }).waitFor()
  check(true, 'set-up: parent signed in with authenticator, Mia joined on the second phone')

  // ---------------- seeded tasks
  await t.getByRole('link', { name: /^Tasks/ }).click()
  check(await seen(t.getByText('Wash the car')) && await seen(t.getByText('Compare prices for new headphones')),
    'Mia sees the example tasks from v6')
  await shot(t, 'teen-01-tasks')
  await t.waitForTimeout(1500) // let the live connection settle

  // ---------------- 1. parent creates a task -> teen phone
  await p.getByRole('link', { name: /^Family/ }).click()
  await p.getByRole('button', { name: 'Add a task' }).click()
  await p.getByLabel('Task', { exact: true }).fill(`Feed the cat ${stamp}`)
  await p.getByLabel('Credits', { exact: true }).fill('7')
  await p.getByRole('button', { name: 'Note', exact: true }).click()
  await shot(p, 'parent-01-add-task')
  await p.getByRole('button', { name: 'Add task' }).click()
  await synced(t.getByText(`Feed the cat ${stamp}`), '1. task created by parent appears on teen phone')

  // ---------------- 2. teen marks it done with a note -> parent Approvals
  await p.getByRole('link', { name: /Approvals/ }).click()
  await p.getByText('All caught up.').waitFor()
  await p.waitForTimeout(1000)
  const card = t.locator('.card', { hasText: `Feed the cat ${stamp}` })
  await card.getByRole('button', { name: 'Mark as done' }).click()
  await card.getByLabel(/Tell Sam what you did/).fill('Fed her twice and cleaned the bowl')
  await card.getByRole('button', { name: 'Send to Sam' }).click()
  await synced(p.getByText('“Fed her twice and cleaned the bowl”'), '2. teen\'s submission (with note) appears in parent Approvals')
  check(await seen(p.locator('.tabs .dot')), 'parent Approvals tab shows a badge')
  await shot(p, 'parent-02-approvals')

  // ---------------- 3. approve (double-tap) -> teen balance
  await t.getByRole('link', { name: /^Credits/ }).click()
  await t.getByText('Credits earned').waitFor()
  await t.waitForTimeout(1000)
  const approve = p.locator('.card', { hasText: `Feed the cat ${stamp}` }).getByRole('button', { name: 'Approve' })
  await approve.dblclick({ force: true }).catch(() => {})
  await synced(t.locator('.big', { hasText: /^7$/ }), '3. approve: teen sees the new balance (7)')
  await t.waitForTimeout(2000)
  check((await t.locator('.big').textContent()).trim() === '7', 'double-tap on Approve paid only once (still 7)')
  check(await seen(t.getByText(`Task: Feed the cat ${stamp}`)), 'credit history shows the task')
  await shot(t, 'teen-02-credits')

  // ---------------- 4. Not yet -> reason, nothing lost, try again
  await t.getByRole('link', { name: /^Tasks/ }).click()
  await t.locator('.card', { hasText: 'Wash the car' }).getByRole('button', { name: 'Mark as done' }).click()
  await t.locator('.card', { hasText: 'Wash the car' }).getByRole('button', { name: 'Send to Sam' }).click()
  const wash = p.locator('.card', { hasText: 'Wash the car' })
  await synced(wash.getByRole('button', { name: 'Checked, approve' }), '4a. check-in task appears for the parent')
  await wash.getByRole('button', { name: 'Not yet' }).click()
  await wash.getByRole('button', { name: "Let's chat about it" }).click()
  const washT = t.locator('.card', { hasText: 'Wash the car' })
  await synced(washT.getByText("Sam: Let's chat about it"), '4b. "Not yet" reason appears on teen phone')
  await shot(t, 'teen-03-not-yet')
  await washT.getByRole('button', { name: 'Try again' }).click()
  await washT.getByRole('button', { name: 'Mark as done' }).click() // v6: "Try again" reopens the task
  await washT.getByRole('button', { name: 'Send to Sam' }).click()
  check(await seen(t.locator('.card', { hasText: 'Wash the car' }).getByText('Waiting for Sam')), 'teen can try again after "Not yet"')
  await t.getByRole('link', { name: /^Credits/ }).click()
  check((await t.locator('.big').textContent()).trim() === '7', '"Not yet" cost nothing (balance still 7)')

  // ---------------- 5. task ideas
  await t.getByRole('link', { name: /^Tasks/ }).click()
  await t.getByLabel(/Got an idea for a task/).fill(`Sort the garage ${stamp}`)
  await t.getByLabel("Credits you'd suggest").fill('20')
  await t.getByRole('button', { name: 'Send idea' }).click()
  const idea = p.locator('.card', { hasText: `Sort the garage ${stamp}` })
  await synced(idea.getByRole('button', { name: 'Edit and accept' }), '5a. task idea appears for the parent')
  await idea.getByRole('button', { name: 'Edit and accept' }).click()
  await idea.getByLabel('Task name').fill(`Sort the garage shelves ${stamp}`)
  await idea.getByLabel('Credits', { exact: true }).fill('25')
  await idea.getByRole('button', { name: 'Save and accept' }).click()
  await synced(t.locator('.card', { hasText: `Sort the garage shelves ${stamp}` }).getByRole('button', { name: 'Mark as done' }),
    '5b. accepted (edited) idea becomes a real task on teen phone')
  check(await seen(t.getByText('Added · 25 credits')), 'teen sees the idea was added with 25 credits')
  await t.getByLabel(/Got an idea for a task/).fill(`Paint my room ${stamp}`)
  await t.getByRole('button', { name: 'Send idea' }).click()
  const idea2 = p.locator('.card', { hasText: `Paint my room ${stamp}` })
  await synced(idea2.getByRole('button', { name: 'Decline' }), '5c. second idea appears for the parent')
  await idea2.getByRole('button', { name: 'Decline' }).click()
  await synced(t.getByText('Not this time'), '5d. declined idea shows "Not this time" on teen phone')

  // ---------------- 6. shout-outs (no limit)
  for (const [i, text] of ['Helped Mrs Lee carry her shopping', 'Walked the neighbour\'s dog', 'Fixed my brother\'s bike'].entries()) {
    await t.getByLabel(/Did something good/).fill(`${text} ${stamp}`)
    await t.getByRole('button', { name: 'Send shout-out' }).click()
    await t.getByText(`Shout-out sent to Sam.`).waitFor()
    if (i === 0) await synced(p.getByText(`“${text} ${stamp}”`), '6a. shout-out appears for the parent')
  }
  check(await seen(p.getByText(`“Fixed my brother's bike ${stamp}”`)), 'no shout-out limit: three in a row all arrive')
  await p.locator('.card', { hasText: `Helped Mrs Lee carry her shopping ${stamp}` }).getByRole('button', { name: '+5' }).click()
  await synced(t.getByText('Sam added 5 credits'), '6b. shout-out reward appears on teen phone')
  const dog = p.locator('.card', { hasText: `Walked the neighbour's dog ${stamp}` })
  await dog.getByRole('button', { name: 'Not yet' }).click()
  await dog.getByLabel('Or write your own').fill('Lovely, but that was a paid job')
  await dog.getByRole('button', { name: 'Send' }).click()
  await synced(t.getByText('Sam: Lovely, but that was a paid job'), '6c. shout-out "Not yet" reason appears on teen phone')
  const bike = p.locator('.card', { hasText: `Fixed my brother's bike ${stamp}` })
  await bike.getByLabel('Other amount').fill('40')
  await bike.getByRole('button', { name: 'Give' }).click()
  await synced(t.getByText('Sam added 40 credits'), '6d. any amount (no cap): 40 credits')

  // ---------------- 7. balances everywhere
  await t.getByRole('link', { name: /^Credits/ }).click()
  check(await seen(t.locator('.big', { hasText: /^52$/ })), 'teen balance is 7 + 5 + 40 = 52')
  await p.getByRole('link', { name: /^Home/ }).click()
  check(await seen(p.locator('.big', { hasText: /^52$/ })), 'parent Home shows Mia\'s 52 credits')
  check(await seen(p.getByText('1 waiting for you')), 'parent Home shows the waiting count (the retried car wash)')
  await shot(p, 'parent-03-home')
  await t.getByRole('link', { name: /^Tasks/ }).click()
  await shot(t, 'teen-04-tasks-after')

  // ---------------- 8. archive
  await p.getByRole('link', { name: /^Family/ }).click()
  await p.getByRole('button', { name: 'Edit Mow the lawn' }).click()
  await p.getByRole('button', { name: 'Archive this task' }).click()
  const t0 = Date.now()
  const gone = await t.locator('.card', { hasText: 'Mow the lawn' }).first().waitFor({ state: 'detached', timeout: SYNC_MS }).then(() => true, () => false)
  timings.push(Date.now() - t0)
  check(gone, `8. archived task disappears from teen phone — ${gone ? ((Date.now() - t0) / 1000).toFixed(1) + ' s' : 'over 5 s'}`)
} catch (e) {
  check(false, 'browser flow crashed', e.message.split('\n')[0])
  await shot(p, 'zz-parent-error')
  await shot(t, 'zz-teen-error')
} finally {
  await browser.close()
}

const failed = results.filter((ok) => !ok).length
if (timings.length) console.log(`\nSync times: max ${(Math.max(...timings) / 1000).toFixed(1)} s, average ${(timings.reduce((a, b) => a + b, 0) / timings.length / 1000).toFixed(1)} s`)
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
