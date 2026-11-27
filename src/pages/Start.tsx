import { Link, Navigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { Spinner } from '../components/ui'
import { lastSide, useAuth } from '../lib/auth'

export default function Start() {
  const { loading, session, role, aal } = useAuth()
  if (loading) return <Spinner />
  // Someone is already signed in on this phone: open their side.
  if (session && role === 'parent') return <Navigate to={aal === 'aal2' ? '/parent' : '/parent/two-step'} replace />
  if (session && role === 'teen') return <Navigate to="/teen" replace />

  const last = lastSide()
  return (
    <Layout side="neutral" title="Welcome">
      <h1>Grow your family's money skills</h1>
      <p className="lead">A parent invests practice money for their teen. The teen earns credits by doing tasks and learning, and watches their garden grow.</p>

      <Link className="choice" to="/parent/login">
        <span className="ico" style={{ background: '#e6efe9' }} aria-hidden="true">🧑‍🌾</span>
        <span>
          <b>I'm a parent</b>
          <span className="lbl">Log in or create your family account</span>
        </span>
      </Link>
      <Link className="choice" to={last === 'teen' ? '/teen/login' : '/teen/join'}>
        <span className="ico" style={{ background: '#fff1c7' }} aria-hidden="true">🌱</span>
        <span>
          <b>I'm a teen</b>
          <span className="lbl">{last === 'teen' ? 'Log in with your username and PIN' : 'Join with the code from your parent'}</span>
        </span>
      </Link>

      <p className="fine" style={{ marginTop: 20 }}>
        This is a test app for our two founding families. Everything uses practice money. Funds, fees and returns are made up — not predictions or advice.{' '}
        <Link to="/privacy">Privacy</Link>
      </p>
    </Layout>
  )
}
