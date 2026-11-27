// new-invite (parent only)
// Cancels any unused invite codes for this teen and issues a fresh one (7 days).
// Joining with the new code lets the teen pick a username and PIN again.
import { adminClient, audit, createInvite, json, requireParent, serve, teenInFamily } from '../_shared/common.ts'

serve(async (req, body) => {
  const parent = await requireParent(req)
  const admin = adminClient()
  const teen = await teenInFamily(admin, body.teen_id, parent.familyId)

  const now = new Date().toISOString()
  const { error: expireErr } = await admin
    .from('invites')
    .update({ expires_at: now })
    .eq('teen_id', teen.id)
    .is('used_at', null)
    .gt('expires_at', now)
  if (expireErr) throw expireErr

  const invite = await createInvite(admin, teen.id)
  await audit(admin, {
    family_id: parent.familyId, actor: parent.id, action: 'invite_created',
    details: { teen_id: teen.id, expires_at: invite.expires_at },
  })
  return json(200, { invite })
})
