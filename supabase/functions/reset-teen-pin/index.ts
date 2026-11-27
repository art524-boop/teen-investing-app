// reset-teen-pin (parent only)
// Sets a new PIN for one of the parent's own teens, clears any lock, signs the
// teen out on every phone (so the old PIN and old sessions stop working), and
// writes to audit_log.
import {
  HttpError, adminClient, audit, checkNewPin, json, pinPassword, requireParent, serve, teenInFamily,
} from '../_shared/common.ts'

serve(async (req, body) => {
  const parent = await requireParent(req)
  const pin = checkNewPin(body.pin)
  const admin = adminClient()
  const teen = await teenInFamily(admin, body.teen_id, parent.familyId)
  if (!teen.username) {
    throw new HttpError(400, 'not_joined', `${teen.nickname} hasn't joined yet. Share their invite code instead.`)
  }

  const { error: pwErr } = await admin.auth.admin.updateUserById(teen.id, { password: await pinPassword(teen.id, pin) })
  if (pwErr) throw pwErr

  const { error: unlockErr } = await admin.rpc('svc_pin_attempt_success', { p_teen: teen.id })
  if (unlockErr) throw unlockErr
  const { error: revokeErr } = await admin.rpc('svc_revoke_sessions', { p_user: teen.id })
  if (revokeErr) throw revokeErr

  await audit(admin, {
    family_id: parent.familyId, actor: parent.id, action: 'pin_reset',
    details: { teen_id: teen.id, nickname: teen.nickname },
  })
  return json(200, { ok: true })
})
