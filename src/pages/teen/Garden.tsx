import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Avatar, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { errorText } from '../../lib/api'

/** Stage 1 placeholder: greets the teen and shows their family name. */
export default function Garden() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState('koala')
  const [family, setFamily] = useState('')

  useEffect(() => {
    ;(async () => {
      const [t, f] = await Promise.all([
        supabase.from('teens').select('nickname, avatar').maybeSingle(),
        supabase.from('families').select('name').maybeSingle(),
      ])
      if (t.error || f.error) setError(errorText(t.error ?? f.error))
      setNickname(t.data?.nickname ?? '')
      setAvatar(t.data?.avatar ?? 'koala')
      setFamily(f.data?.name ?? '')
      setLoading(false)
    })()
  }, [])

  const logOut = async () => {
    await supabase.auth.signOut()
    navigate('/teen/login', { replace: true })
  }

  if (loading) return <Spinner />

  return (
    <Layout side="teen" title="Garden">
      <div className="topbar">
        <span className="lbl">{family}</span>
        <Avatar avatar={avatar} size={40} />
      </div>
      <h1>Hi {nickname}</h1>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="garden" aria-hidden="true">
        <svg viewBox="0 0 400 300">
          <rect width="400" height="300" fill="#bfe7f7" />
          <circle cx="330" cy="62" r="30" fill="#ffc83d" />
          <path d="M0 210 Q100 185 200 205 T400 200 V300 H0Z" fill="#8fcf7a" />
          <path d="M0 238 Q120 220 240 236 T400 232 V300 H0Z" fill="#6bb35a" />
          <ellipse cx="200" cy="246" rx="46" ry="10" fill="#7a5a3a" opacity=".55" />
          <g className="grow">
            <path d="M200 246 V200" stroke="#2f7d3c" strokeWidth="6" strokeLinecap="round" />
            <path d="M200 214 C182 206 172 192 174 178 C192 182 202 196 200 214Z" fill="#3fae5a" />
            <path d="M200 204 C218 196 230 182 228 166 C210 170 198 186 200 204Z" fill="#4fc06a" />
          </g>
        </svg>
      </div>
      <div className="card">
        <b>Welcome to the {family || 'family'} garden</b>
        <p className="fine">Your garden starts growing when your family's practice investing begins. Tasks and learning arrive soon.</p>
      </div>
      <button type="button" className="btn wide" onClick={logOut}>Log out</button>
    </Layout>
  )
}
