import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { errorText } from '../../lib/api'

type Mode =
  | { kind: 'loading' }
  | { kind: 'verify'; factorId: string }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string }
  | { kind: 'error'; message: string }

/** Sets up the authenticator app the first time, then asks for its 6-digit code at every log in. */
export default function ParentTwoStep() {
  const { loading, session, role, aal, refresh } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (loading || !session || role !== 'parent' || aal === 'aal2' || started.current) return
    started.current = true
    ;(async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return setMode({ kind: 'error', message: errorText(error) })
      const verified = data.totp.find((f) => f.status === 'verified')
      if (verified) return setMode({ kind: 'verify', factorId: verified.id })
      // Clear any half-finished setup from an earlier visit, then start fresh.
      for (const f of data.all) {
        if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data: en, error: enErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
        issuer: 'Teen Investing (practice)',
      })
      if (enErr || !en) return setMode({ kind: 'error', message: errorText(enErr) })
      setMode({ kind: 'enroll', factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret })
    })()
  }, [loading, session, role, aal])

  if (loading) return <Spinner />
  if (!session || role !== 'parent') return <Navigate to="/parent/login" replace />
  if (aal === 'aal2') return <Navigate to="/parent" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode.kind !== 'verify' && mode.kind !== 'enroll') return
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mode.factorId, code })
    setBusy(false)
    if (error) {
      setCode('')
      return setError(error.code === 'mfa_verification_failed' ? 'That code didn’t match. Codes change every 30 seconds — try the current one.' : errorText(error))
    }
    await refresh()
    navigate('/parent', { replace: true })
  }

  const logOut = async () => {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
  }

  const codeField = (
    <form onSubmit={submit} noValidate>
      <Field label="6-digit code from your authenticator app" error={error}>
        {({ id, describedBy, invalid }) => (
          <input
            id={id} className="pin" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code"
            maxLength={6} value={code} aria-describedby={describedBy} aria-invalid={invalid || undefined} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
      </Field>
      <button className="btn pri wide" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</button>
    </form>
  )

  return (
    <Layout side="parent" title="Two-step verification">
      <h1>{mode.kind === 'enroll' ? 'Set up two-step verification' : 'Enter your code'}</h1>
      {mode.kind === 'loading' && <Spinner label="Getting ready…" />}
      {mode.kind === 'error' && <p className="err" role="alert">{mode.message}</p>}
      {mode.kind === 'verify' && (
        <>
          <p className="lead">Open your authenticator app and enter the code for Teen Investing.</p>
          {codeField}
        </>
      )}
      {mode.kind === 'enroll' && (
        <>
          <p className="lead">This keeps your family's account safe, even if someone learns your password.</p>
          <ol style={{ paddingLeft: 20 }}>
            <li>Install an authenticator app, such as Google Authenticator or Microsoft Authenticator.</li>
            <li>In the app, add an account and scan this code.</li>
          </ol>
          <img className="qr" src={mode.qr} alt="QR code to add Teen Investing to your authenticator app" />
          <p className="fine">Can't scan? On this phone, choose “enter a setup key” in the app and type:</p>
          <p className="secret" aria-label="Setup key">{mode.secret}</p>
          <ol start={3} style={{ paddingLeft: 20 }}>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          {codeField}
        </>
      )}
      <button type="button" className="btn ghost wide" onClick={logOut}>Log out</button>
    </Layout>
  )
}
