import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field, PinInput, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { ApiError, callFn, errorText } from '../../lib/api'
import { weakPin } from '../../lib/avatars'

type Step = 'code' | 'username' | 'pin'

/** Invite code → choose username → choose PIN (twice). One server call at the end. */
export default function TeenJoin() {
  const { loading, session, role, refresh } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('code')
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <Spinner />
  if (session && role === 'teen') return <Navigate to="/teen" replace />

  const stepNo = step === 'code' ? 1 : step === 'username' ? 2 : 3

  const next = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (step === 'code') {
      const c = code.toUpperCase().replace(/[\s-]/g, '')
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(c)) return setError('Invite codes are 6 letters and numbers. Check it with your parent.')
      setCode(c)
      setStep('username')
    } else if (step === 'username') {
      const u = username.trim().toLowerCase()
      if (!/^[a-z0-9_]{3,20}$/.test(u)) return setError('Use 3 to 20 letters, numbers or underscores.')
      setUsername(u)
      setStep('pin')
    } else {
      void finish()
    }
  }

  const finish = async () => {
    if (pin.length !== 6) return setError('Your PIN must be 6 digits.')
    if (weakPin(pin)) return setError('That PIN is too easy to guess. Try a less obvious one.')
    if (pin !== pin2) return setError('The two PINs don’t match. Try again.')
    setBusy(true)
    try {
      const r = await callFn<{ session: { access_token: string; refresh_token: string } }>('teen-join', { code, username, pin })
      // A parent signed in on this phone is replaced by the teen.
      await supabase.auth.setSession(r.session)
      await refresh()
      navigate('/teen', { replace: true })
    } catch (e) {
      setBusy(false)
      if (e instanceof ApiError && e.code === 'bad_code') { setStep('code'); setPin(''); setPin2('') }
      if (e instanceof ApiError && e.code === 'username_taken') setStep('username')
      setError(errorText(e))
    }
  }

  const back = () => {
    setError('')
    setStep(step === 'pin' ? 'username' : 'code')
  }

  return (
    <Layout side="teen" title="Join your family">
      <p>{step === 'code' ? <Link to="/">← Back</Link> : <button type="button" className="btn ghost" onClick={back}>← Back</button>}</p>
      <div className="lbl" aria-live="polite">Step {stepNo} of 3</div>
      <form onSubmit={next} noValidate>
        {step === 'code' && (
          <>
            <h1>Join your family</h1>
            <p className="lead">Ask your parent for your 6-character invite code.</p>
            <Field label="Invite code" error={error}>
              {({ id, describedBy, invalid }) => (
                <input id={id} className="code-in" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                  maxLength={8} value={code} aria-describedby={describedBy} aria-invalid={invalid || undefined} autoFocus
                  onChange={(e) => setCode(e.target.value.toUpperCase())} />
              )}
            </Field>
          </>
        )}
        {step === 'username' && (
          <>
            <h1>Choose a username</h1>
            <p className="lead">You'll use it to log in. Don't use your real name.</p>
            <Field label="Username" hint="3 to 20 letters, numbers or _" error={error}>
              {({ id, describedBy, invalid }) => (
                <input id={id} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20}
                  value={username} aria-describedby={describedBy} aria-invalid={invalid || undefined} autoFocus
                  onChange={(e) => setUsername(e.target.value.toLowerCase())} />
              )}
            </Field>
          </>
        )}
        {step === 'pin' && (
          <>
            <h1>Choose a PIN</h1>
            <p className="lead">6 digits that only you know. Not your birthday, and not 123456.</p>
            <Field label="PIN">
              {({ id }) => <PinInput id={id} value={pin} onChange={setPin} autoComplete="new-password" autoFocus />}
            </Field>
            <Field label="Enter your PIN again" error={error}>
              {({ id, describedBy, invalid }) => (
                <PinInput id={id} value={pin2} onChange={setPin2} autoComplete="new-password" describedBy={describedBy} invalid={invalid} />
              )}
            </Field>
          </>
        )}
        <button className="btn pri wide" type="submit" disabled={busy}>
          {step === 'pin' ? (busy ? 'Joining…' : 'Join') : 'Next'}
        </button>
      </form>
      <p className="fine">Already joined? <Link to="/teen/login">Log in</Link></p>
    </Layout>
  )
}
