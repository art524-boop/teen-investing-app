import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { errorText } from '../../lib/api'

export default function ParentSignUp() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [family, setFamily] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim() || !family.trim()) return setError('Please fill in your name and your family name.')
    if (password.length < 10) return setError('Please use a password of at least 10 characters.')
    if (!consent) return setError('Please tick the box to agree to the privacy policy.')
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/parent/two-step`,
        data: { display_name: name.trim(), family_name: family.trim(), consent: 'true' },
      },
    })
    setBusy(false)
    if (error) return setError(errorText(error))
    setSent(true)
  }

  if (sent) {
    return (
      <Layout side="parent" title="Check your email">
        <h1>Check your email</h1>
        <p>We sent a link to <b>{email}</b>. Open it on this phone to confirm your address.</p>
        <p>Next you'll set up an authenticator app (such as Google Authenticator or Microsoft Authenticator) for two-step verification.</p>
        <p className="fine">No email after a few minutes? Check your junk folder.</p>
        <Link className="btn wide" to="/parent/login">Go to log in</Link>
      </Layout>
    )
  }

  return (
    <Layout side="parent" title="Create your family account">
      <p><Link to="/">← Back</Link></p>
      <h1>Create your family account</h1>
      <form onSubmit={submit} noValidate>
        <Field label="Your name">
          {({ id }) => <input id={id} type="text" autoComplete="name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />}
        </Field>
        <Field label="Email">
          {({ id }) => <input id={id} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          {({ id, describedBy }) => (
            <input id={id} type="password" autoComplete="new-password" value={password} aria-describedby={describedBy} onChange={(e) => setPassword(e.target.value)} required />
          )}
        </Field>
        <Field label="Family name" hint="Your teen sees this, e.g. “The Nguyens”.">
          {({ id, describedBy }) => (
            <input id={id} type="text" value={family} maxLength={60} aria-describedby={describedBy} onChange={(e) => setFamily(e.target.value)} required />
          )}
        </Field>
        <label className="chk">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree to the <Link to="/privacy" target="_blank">privacy policy</Link>.</span>
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn pri wide" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="fine">Already have an account? <Link to="/parent/login">Log in</Link></p>
    </Layout>
  )
}
