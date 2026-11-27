import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { TeenTabs } from '../../components/Tabs'
import { Avatar, Spinner } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { useFamily } from '../../lib/familyData'

/** Garden placeholder (the real garden arrives in Stage 5): greeting, family, today's summary. */
export default function Garden() {
  const { signOut } = useAuth()
  const { loading, error, teens, familyName, tasks, balances } = useFamily()
  const me = teens[0]
  const due = tasks.filter((t) => t.status === 'open').length

  if (loading) return <Spinner />

  return (
    <Layout side="teen" title="Garden" tabs={<TeenTabs />}>
      <div className="topbar">
        <span className="lbl">{familyName}</span>
        {me && <Avatar avatar={me.avatar} size={40} />}
      </div>
      <h1>Hi {me?.nickname}</h1>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="wrap" aria-label="Today" style={{ marginTop: 0, marginBottom: 10 }}>
        <Link className="chip" to="/teen/tasks">{due} task{due === 1 ? '' : 's'} to do</Link>
        <Link className="chip" to="/teen/credits">{me ? balances[me.id] ?? 0 : 0} credits</Link>
      </div>
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
        <b>Welcome to your garden</b>
        <p className="fine">Your garden starts growing when your family's practice investing begins. For now, earn credits by doing tasks.</p>
      </div>
      <button type="button" className="btn wide" onClick={() => signOut('/teen/login')}>Log out</button>
    </Layout>
  )
}
