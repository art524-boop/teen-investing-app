// create-teen (parent only)
// Creates the teen's auth user (synthetic @teens.invalid email, already confirmed,
// app_metadata role 'teen' + family_id), the teens row with the consent date, and a
// 6-character invite code that expires in 7 days. Writes to audit_log.
import {
  AVATARS, HttpError, adminClient, audit, createInvite, json, randomHex, requireParent, serve, teenEmail,
} from '../_shared/common.ts'

serve(async (req, body) => {
  const parent = await requireParent(req)

  const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : ''
  const ageBand = Number(body.age_band)
  const avatar = String(body.avatar ?? '')
  if (nickname.length < 1 || nickname.length > 30) {
    throw new HttpError(400, 'bad_nickname', 'Enter a nickname (up to 30 characters).')
  }
  if (!Number.isInteger(ageBand) || ageBand < 13 || ageBand > 17) {
    throw new HttpError(400, 'bad_age', 'Choose an age from 13 to 17.')
  }
  if (!(AVATARS as readonly string[]).includes(avatar)) {
    throw new HttpError(400, 'bad_avatar', 'Choose an avatar.')
  }
  if (body.consent !== true) {
    throw new HttpError(400, 'needs_consent', 'Please tick the box to confirm you are the parent or guardian.')
  }

  const admin = adminClient()
  const wantedId = crypto.randomUUID()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    id: wantedId,
    email: teenEmail(wantedId),
    email_confirm: true, // @teens.invalid cannot receive email
    password: randomHex(32), // unusable until the teen joins and picks a PIN
    app_metadata: { role: 'teen', family_id: parent.familyId },
  })
  if (createErr || !created.user) throw createErr ?? new Error('createUser returned no user')

  const teenId = created.user.id
  try {
    if (teenId !== wantedId) {
      // Older Auth versions ignore a supplied id: point the email at the real id.
      const { error } = await admin.auth.admin.updateUserById(teenId, { email: teenEmail(teenId), email_confirm: true })
      if (error) throw error
    }
    const consentAt = new Date().toISOString()
    const { error: teenErr } = await admin.from('teens').insert({
      id: teenId,
      family_id: parent.familyId,
      nickname,
      age_band: ageBand,
      avatar,
      consent_at: consentAt,
    })
    if (teenErr) throw teenErr
  } catch (e) {
    await admin.auth.admin.deleteUser(teenId)
    throw e
  }

  const invite = await createInvite(admin, teenId)

  await audit(admin, {
    family_id: parent.familyId, actor: parent.id, action: 'teen_added',
    details: { teen_id: teenId, nickname, age_band: ageBand },
  })
  await audit(admin, {
    family_id: parent.familyId, actor: parent.id, action: 'consent_given',
    details: { teen_id: teenId, nickname },
  })
  await audit(admin, {
    family_id: parent.familyId, actor: parent.id, action: 'invite_created',
    details: { teen_id: teenId, expires_at: invite.expires_at },
  })

  return json(200, {
    teen: { id: teenId, nickname, age_band: ageBand, avatar },
    invite,
  })
})
