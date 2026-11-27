import { Layout } from '../../components/Layout'
import { TeenTabs } from '../../components/Tabs'
import { Spinner } from '../../components/ui'
import { fmtDay, useFamily } from '../../lib/familyData'

/** Current balance and recent credit changes. Milestones arrive in Stage 4. */
export default function TeenCredits() {
  const { loading, error, teens, balances, ledger, submissions, tasks, parentName } = useFamily()
  const me = teens[0]
  const balance = me ? balances[me.id] ?? 0 : 0
  const waiting = submissions
    .filter((s) => s.decision === 'pending')
    .reduce((sum, s) => sum + (tasks.find((t) => t.id === s.task_id)?.credits ?? 0), 0)

  return (
    <Layout side="teen" title="Credits" tabs={<TeenTabs />}>
      <h1>Your credits</h1>
      {loading && <Spinner />}
      {error && <p className="err" role="alert">{error}</p>}
      {!loading && (
        <>
          <div className="card">
            <div className="lbl">Credits earned</div>
            <div className="big" aria-live="polite">{balance}</div>
            {waiting > 0 && <p className="fine">+{waiting} more waiting for {parentName} to approve.</p>}
            <p className="fine">Credits are points, not money. You earn them from tasks and shout-outs, and soon from learning. There's no limit.</p>
          </div>
          <span className="sec">Recent changes</span>
          {ledger.length === 0 ? (
            <div className="card lock"><p className="fine" style={{ margin: 0 }}>Nothing yet. Finish a task to earn your first credits.</p></div>
          ) : (
            <div className="card">
              {ledger.slice(0, 50).map((l, i) => (
                <div className={i ? 'act row' : 'row'} key={l.id} style={i ? undefined : { padding: '8px 0' }}>
                  <span>{l.reason}<br /><span className="lbl">{fmtDay(l.created_at)}</span></span>
                  <span className={`amt ${l.change > 0 ? 'up' : ''}`}>{l.change > 0 ? '+' : ''}{l.change}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  )
}
