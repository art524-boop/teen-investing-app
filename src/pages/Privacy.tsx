import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'

export default function Privacy() {
  return (
    <Layout side="neutral" title="Privacy">
      <p><Link to="/">← Back</Link></p>
      <h1>Privacy, in plain English</h1>
      <p className="lead">The full policy and a teen-friendly version are coming soon. Here is what this test app does today.</p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>What we keep</h2>
        <ul>
          <li><b>Parent:</b> your name, email, password (scrambled) and your family's name.</li>
          <li><b>Teen:</b> a nickname, age band (13–17), avatar, username and PIN (scrambled). No email, phone, date of birth, photos or location.</li>
          <li>When a parent adds a teen, we save the date they agreed to this policy.</li>
        </ul>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>What we never do</h2>
        <ul>
          <li>No ads, no third-party trackers or analytics.</li>
          <li>No chat and no public profiles.</li>
          <li>No real money: everything is practice money.</li>
        </ul>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Where it lives</h2>
        <p style={{ margin: 0 }}>Your data is stored in Sydney, Australia. A "Delete our family's data" button is coming in a later stage.</p>
      </div>
    </Layout>
  )
}
