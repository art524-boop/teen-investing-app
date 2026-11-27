import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field, PinInput, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { ApiError, callFn, errorText } from '../../lib/api'

export default function TeenLogin() {
  const { loading, session, role, refresh } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)

  if (loading) return <Spinner />
  if (session && role === 'teen') return <Navigate to="/teen" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLocked(false)
    setBusy(true)
    try {
      const r = await callFn<{ session: { access_token: string; refresh_token: string } }>('teen-login', {
        username: username.trim().toLowerCase(), pin,
      })
      await supabase.auth.setSession(r.session)
      await refresh()
      navigate('/teen', { replace: true })
    } catch (err) {
      setBusy(false)
      setPin('')
      if (err instanceof ApiError && err.code === 'locked') setLocked(true)
      setError(errorText(err))
    }
  }

  return (
    <Layout side="teen" title="Teen log in">
      <p><Link to="/">← Back</Link></p>
      <h1>Welcome back</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Username">
          {({ id }) => (
            <input id={id} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20}
              value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
          )}
        </Field>
        <Field label="PIN">
          {({ id }) => <PinInput id={id} value={pin} onChange={setPin} autoComplete="current-password" />}
        </Field>
        {error && (
          locked
            ? <div className="warn" role="alert"><b>Your account is locked.</b><br />{error}</div>
            : <p className="err" role="alert">{error}</p>
        )}
        <button className="btn pri wide" type="submit" disabled={busy || !username || pin.length !== 6}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="fine">Forgot your PIN? Ask your parent to reset it.</p>
      <p className="fine">First time? <Link to="/teen/join">Join with your invite code</Link></p>
    </Layout>
  )
}
