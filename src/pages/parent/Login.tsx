import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { errorText } from '../../lib/api'

export default function ParentLogin() {
  const { loading, session, role, aal, refresh } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (loading) return <Spinner />
  if (session && role === 'parent') return <Navigate to={aal === 'aal2' ? '/parent' : '/parent/two-step'} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      return setError(
        error.code === 'email_not_confirmed'
          ? 'Please confirm your email first: open the link we sent you.'
          : error.code === 'invalid_credentials' ? 'That email or password isn’t right.' : errorText(error),
      )
    }
    if ((data.user?.app_metadata as Record<string, unknown>)?.role !== 'parent') {
      await supabase.auth.signOut()
      await refresh()
      return setError('This login is for parents. Teens log in with their username and PIN.')
    }
    await refresh()
    navigate('/parent/two-step', { replace: true })
  }

  return (
    <Layout side="parent" title="Parent log in">
      <p><Link to="/">← Back</Link></p>
      <h1>Parent log in</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Email">
          {({ id }) => <input id={id} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Password">
          {({ id }) => <input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn pri wide" type="submit" disabled={busy || !email || !password}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p className="fine">Next you'll enter the 6-digit code from your authenticator app.</p>
      <div className="card" style={{ marginTop: 20 }}>
        <b>New here?</b>
        <p className="fine" style={{ marginTop: 4 }}>Create a family account, then add your teen.</p>
        <Link className="btn wide" to="/parent/signup">Create family account</Link>
      </div>
    </Layout>
  )
}
