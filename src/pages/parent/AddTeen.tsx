import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { AvatarPicker, Field } from '../../components/ui'
import { InviteCard, type Invite } from './InviteCard'
import { callFn, errorText } from '../../lib/api'
import { useFamily } from '../../lib/familyData'

const AGES = [13, 14, 15, 16, 17]

export default function AddTeen() {
  const { reload } = useFamily()
  const [nickname, setNickname] = useState('')
  const [age, setAge] = useState<number | null>(null)
  const [avatar, setAvatar] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ nickname: string; invite: Invite } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!nickname.trim()) return setError('Please enter a nickname.')
    if (!age) return setError('Please choose an age.')
    if (!avatar) return setError('Please choose an avatar.')
    if (!consent) return setError('Please tick the box to confirm you are the parent or guardian.')
    setBusy(true)
    try {
      const r = await callFn<{ teen: { nickname: string }; invite: Invite }>('create-teen', {
        nickname: nickname.trim(), age_band: age, avatar, consent: true,
      })
      setResult({ nickname: r.teen.nickname, invite: r.invite })
      void reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Layout side="parent" title="Invite code">
        <h1>{result.nickname} is added</h1>
        <InviteCard nickname={result.nickname} invite={result.invite} />
        <Link className="btn pri wide" to="/parent">Done</Link>
      </Layout>
    )
  }

  return (
    <Layout side="parent" title="Add a teen">
      <p><Link to="/parent">← Home</Link></p>
      <h1>Add a teen</h1>
      <p className="lead">We only keep a nickname, age and avatar. No email, phone, birthday or photos.</p>
      <form onSubmit={submit} noValidate>
        <Field label="Nickname" hint="What your teen likes to be called.">
          {({ id, describedBy }) => (
            <input id={id} type="text" value={nickname} maxLength={30} autoComplete="off" aria-describedby={describedBy} onChange={(e) => setNickname(e.target.value)} />
          )}
        </Field>
        <div className="field" role="group" aria-labelledby="age-label">
          <div className="label" id="age-label">Age</div>
          <div className="seg">
            {AGES.map((a) => (
              <button type="button" key={a} aria-pressed={age === a} onClick={() => setAge(a)}>{a}</button>
            ))}
          </div>
        </div>
        <AvatarPicker value={avatar} onChange={setAvatar} />
        <label className="chk">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I am this teen's parent or guardian and I agree to the <Link to="/privacy" target="_blank">privacy policy</Link>.</span>
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn pri wide" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add teen and get invite code'}</button>
      </form>
    </Layout>
  )
}
