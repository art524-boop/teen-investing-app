import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { errorText } from '../../lib/api'

export default function Account() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const change = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (pw.length < 10) return setMsg({ ok: false, text: 'Please use at least 10 characters.' })
    if (pw !== pw2) return setMsg({ ok: false, text: 'The two passwords don’t match.' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errorText(error) })
    setPw(''); setPw2('')
    setMsg({ ok: true, text: 'Your password has been changed.' })
  }

  const logOut = async () => {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
  }

  return (
    <Layout side="parent" title="Account">
      <p><Link to="/parent">← Home</Link></p>
      <h1>Account</h1>
      <div className="card">
        <div className="lbl">Logged in as</div>
        <div>{session?.user.email}</div>
        <p className="fine">Two-step verification is on.</p>
      </div>

      <h2>Change password</h2>
      <form onSubmit={change} noValidate>
        <Field label="New password" hint="At least 10 characters.">
          {({ id, describedBy }) => (
            <input id={id} type="password" autoComplete="new-password" value={pw} aria-describedby={describedBy} onChange={(e) => setPw(e.target.value)} />
          )}
        </Field>
        <Field label="Enter it again">
          {({ id }) => <input id={id} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
        </Field>
        {msg && <p className={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        <button className="btn pri wide" type="submit" disabled={busy || !pw}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>

      <h2>Privacy</h2>
      <p><Link to="/privacy">Read how we handle your family's data</Link></p>

      <button type="button" className="btn wide" style={{ marginTop: 24 }} onClick={logOut}>Log out</button>
    </Layout>
  )
}
