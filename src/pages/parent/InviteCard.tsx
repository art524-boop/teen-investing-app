import { useState } from 'react'
import { fmtDate } from '../../lib/api'

export interface Invite {
  code: string
  expires_at: string
}

/** Shows an invite code with a copy button, its expiry, and how the teen uses it. */
export function InviteCard({ nickname, invite }: { nickname: string; invite: Invite }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="card calm">
      <div className="lbl">Invite code for {nickname}</div>
      <div className="code" aria-label={`Invite code: ${invite.code.split('').join(' ')}`}>{invite.code}</div>
      <button type="button" className="btn wide" onClick={copy} style={{ marginTop: 4 }}>
        {copied ? 'Copied ✓' : 'Copy code'}
      </button>
      <span className="sr-only" role="status">{copied ? 'Code copied' : ''}</span>
      <p className="fine">Works once. Expires {fmtDate(invite.expires_at)} (Sydney time).</p>
      <p className="fine">
        On {nickname}'s phone: open <b>{window.location.host}</b>, tap <b>I'm a teen</b>, then enter this code.
      </p>
    </div>
  )
}
