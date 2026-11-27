import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Avatar, Field, PinInput, Sheet, Spinner } from '../../components/ui'
import { InviteCard, type Invite } from './InviteCard'
import { supabase } from '../../lib/supabase'
import { callFn, errorText, fmtTime } from '../../lib/api'
import { weakPin } from '../../lib/avatars'

interface Teen {
  id: string
  nickname: string
  age_band: number
  avatar: string
  username: string | null
  locked_until: string | null
}

interface Row extends Teen {
  invite: Invite | null
}

/** Placeholder Home for Stage 1: the family's teens with Reset PIN and New invite code. */
export default function ParentHome() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [parentName, setParentName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [resetFor, setResetFor] = useState<Row | null>(null)
  const [inviteFor, setInviteFor] = useState<{ nickname: string; invite: Invite } | null>(null)
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    const nowIso = new Date().toISOString()
    const [p, f, t, i] = await Promise.all([
      supabase.from('parents').select('display_name').maybeSingle(),
      supabase.from('families').select('name').maybeSingle(),
      supabase.from('teens').select('id, nickname, age_band, avatar, username, locked_until').order('created_at'),
      supabase.from('invites').select('code, teen_id, expires_at').is('used_at', null).gt('expires_at', nowIso).order('created_at', { ascending: false }),
    ])
    const err = p.error ?? f.error ?? t.error ?? i.error
    if (err) {
      setError(errorText(err))
    } else {
      setParentName(p.data?.display_name ?? '')
      setFamilyName(f.data?.name ?? '')
      const invites = (i.data ?? []) as (Invite & { teen_id: string })[]
      setRows(((t.data ?? []) as Teen[]).map((teen) => ({
        ...teen,
        invite: invites.find((inv) => inv.teen_id === teen.id) ?? null,
      })))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const newInvite = async (row: Row) => {
    setBusyId(row.id)
    setNotice('')
    try {
      const r = await callFn<{ invite: Invite }>('new-invite', { teen_id: row.id })
      setInviteFor({ nickname: row.nickname, invite: r.invite })
      await load()
    } catch (e) {
      setNotice(errorText(e))
    } finally {
      setBusyId('')
    }
  }

  return (
    <Layout side="parent" title="Home">
      <div className="topbar">
        <span className="lbl">{familyName}</span>
        <Link className="btn ghost sm" to="/parent/account">Account</Link>
      </div>
      <h1>Hi {parentName || 'there'}</h1>

      {loading && <Spinner />}
      {error && <p className="err" role="alert">{error}</p>}
      {notice && <p className="err" role="alert">{notice}</p>}

      {!loading && !error && (
        <>
          <h2>Your teens</h2>
          {rows.length === 0 && (
            <div className="card">
              <p style={{ marginTop: 0 }}>Add your teen to get an invite code for their phone.</p>
            </div>
          )}
          {rows.map((row) => {
            const locked = row.locked_until && row.locked_until > new Date().toISOString()
            return (
              <div className="card" key={row.id}>
                <div className="teen-row">
                  <Avatar avatar={row.avatar} size={48} />
                  <div style={{ flex: 1 }}>
                    <h3>{row.nickname}</h3>
                    <div className="lbl">Age {row.age_band}{row.username ? ` · @${row.username}` : ''}</div>
                  </div>
                  {row.username
                    ? <span className={`chip ${locked ? 'no' : 'ok'}`}>{locked ? 'Locked' : 'Joined'}</span>
                    : <span className="chip wait">Not joined yet</span>}
                </div>
                {locked && (
                  <p className="warn">Locked after 5 wrong PINs until {fmtTime(row.locked_until!)}. Resetting the PIN unlocks it now.</p>
                )}
                {!row.username && row.invite && (
                  <p className="fine">Invite code <b style={{ letterSpacing: '.1em' }}>{row.invite.code}</b> is waiting to be used.</p>
                )}
                {!row.username && !row.invite && (
                  <p className="fine">Their invite code has expired. Make a new one.</p>
                )}
                <div className="two">
                  <button type="button" className="btn sm" disabled={!row.username} onClick={() => setResetFor(row)}
                    aria-describedby={!row.username ? `nr-${row.id}` : undefined}>
                    Reset PIN
                  </button>
                  <button type="button" className="btn sm" disabled={busyId === row.id} onClick={() => newInvite(row)}>
                    {busyId === row.id ? 'Making…' : 'New invite code'}
                  </button>
                </div>
                {!row.username && <span className="sr-only" id={`nr-${row.id}`}>Available after {row.nickname} joins</span>}
              </div>
            )
          })}
          <Link className="btn pri wide" to="/parent/add-teen">Add a teen</Link>
          <p className="fine" style={{ marginTop: 16 }}>
            Tasks, learning and practice investing arrive in the next stages of this test app.
          </p>
        </>
      )}

      <ResetPinSheet row={resetFor} onClose={() => setResetFor(null)} onDone={load} />
      <Sheet open={Boolean(inviteFor)} onClose={() => setInviteFor(null)} title="New invite code">
        {inviteFor && (
          <>
            <InviteCard nickname={inviteFor.nickname} invite={inviteFor.invite} />
            <p className="fine">Any older code for {inviteFor.nickname} no longer works. Joining with this code lets them choose a username and PIN again.</p>
            <button type="button" className="btn wide" onClick={() => setInviteFor(null)}>Close</button>
          </>
        )}
      </Sheet>
    </Layout>
  )
}

function ResetPinSheet({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setPin(''); setPin2(''); setError(''); setDone(false)
  }, [row])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!row) return
    setError('')
    if (pin.length !== 6) return setError('The PIN must be 6 digits.')
    if (weakPin(pin)) return setError('That PIN is too easy to guess. Try a less obvious one.')
    if (pin !== pin2) return setError('The two PINs don’t match.')
    setBusy(true)
    try {
      await callFn('reset-teen-pin', { teen_id: row.id, pin })
      setDone(true)
      onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={Boolean(row)} onClose={onClose} title={row ? `Reset ${row.nickname}'s PIN` : 'Reset PIN'}>
      {done ? (
        <>
          <p className="ok" role="status">Done. Tell {row?.nickname} their new PIN. The old PIN no longer works, and they've been logged out on their phone.</p>
          <button type="button" className="btn wide" onClick={onClose}>Close</button>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="fine" style={{ marginTop: 0 }}>Choose a new 6-digit PIN and tell {row?.nickname} in person.</p>
          <Field label="New PIN">
            {({ id }) => <PinInput id={id} value={pin} onChange={setPin} autoComplete="new-password" />}
          </Field>
          <Field label="Enter it again">
            {({ id }) => <PinInput id={id} value={pin2} onChange={setPin2} autoComplete="new-password" />}
          </Field>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="two">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Reset PIN'}</button>
          </div>
        </form>
      )}
    </Sheet>
  )
}
