import { useEffect, useState } from 'react'
import { Layout } from '../../components/Layout'
import { ParentTabs } from '../../components/Tabs'
import { Avatar, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { errorText } from '../../lib/api'
import { PROOF_LABEL, fmtDay, useFamily, type Idea, type Shoutout, type Submission, type Task, type TeenLite } from '../../lib/familyData'

// Quick reasons from v6 (weekly wording: tasks repeat weekly here).
const TASK_REASONS = ['Nearly there, finish it off', "Let's chat about it", 'Have another go this week']
const SHOUT_REASONS = ['Thanks for telling me. Not this time, but keep it up.', "Let's chat about it"]

type Item =
  | { kind: 'task'; at: string; sub: Submission; task: Task | undefined }
  | { kind: 'shout'; at: string; shout: Shoutout }
  | { kind: 'idea'; at: string; idea: Idea }

export default function Approvals() {
  const { loading, error, teens, tasks, submissions, shoutouts, ideas, reload } = useFamily()
  useEffect(() => { void reload() }, [reload]) // fresh data whenever this tab opens
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const items: Item[] = [
    ...submissions.filter((s) => s.decision === 'pending')
      .map((sub): Item => ({ kind: 'task', at: sub.submitted_at, sub, task: tasks.find((t) => t.id === sub.task_id) })),
    ...shoutouts.filter((s) => s.status === 'pending').map((shout): Item => ({ kind: 'shout', at: shout.created_at, shout })),
    ...ideas.filter((i) => i.status === 'pending').map((idea): Item => ({ kind: 'idea', at: idea.created_at, idea })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  const teenOf = (id: string) => teens.find((t) => t.id === id)

  const decide = async (fn: string, args: Record<string, unknown>, done: string) => {
    setMsg(null)
    const { error } = await supabase.rpc(fn, args)
    if (error) {
      setMsg({ ok: false, text: errorText(error) })
      return false
    }
    setMsg({ ok: true, text: done })
    await reload()
    return true
  }

  return (
    <Layout side="parent" title="Approvals" tabs={<ParentTabs />}>
      <h1>Approvals</h1>
      <p className="fine" style={{ marginTop: 0 }}>No monthly cap: every credit you approve counts.</p>
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}</div>
      {loading && <Spinner />}
      {error && <p className="err" role="alert">{error}</p>}
      {!loading && items.length === 0 && (
        <div className="card lock">
          <b>All caught up.</b>
          <p className="fine">Tasks, shout-outs and task ideas show up here as soon as they're sent.</p>
        </div>
      )}
      {items.map((it) =>
        it.kind === 'task' ? <TaskCard key={it.sub.id} sub={it.sub} task={it.task} teen={teenOf(it.sub.teen_id)} decide={decide} />
        : it.kind === 'shout' ? <ShoutCard key={it.shout.id} shout={it.shout} teen={teenOf(it.shout.teen_id)} decide={decide} />
        : <IdeaCard key={it.idea.id} idea={it.idea} teen={teenOf(it.idea.teen_id)} decide={decide} />,
      )}
    </Layout>
  )
}

type Decide = (fn: string, args: Record<string, unknown>, done: string) => Promise<boolean>

function From({ teen, what, at }: { teen: TeenLite | undefined; what: string; at: string }) {
  return (
    <div className="row start" style={{ gap: 8, marginBottom: 6 }}>
      {teen && <Avatar avatar={teen.avatar} size={28} />}
      <span className="lbl">{what} from {teen?.nickname ?? 'your teen'} · {fmtDay(at)}</span>
    </div>
  )
}

/** "Not yet" with v6's quick reasons plus free text. */
function ReasonPicker({ reasons, onPick, onCancel, busy, name }: {
  reasons: string[]; onPick: (r: string) => void; onCancel: () => void; busy: boolean; name: string
}) {
  const [own, setOwn] = useState('')
  const id = `own-${name}`
  return (
    <div>
      <p className="fine">Pick a short reason {name} will see:</p>
      <div className="wrap">
        {reasons.map((r) => <button key={r} type="button" className="btn sm" disabled={busy} onClick={() => onPick(r)}>{r}</button>)}
      </div>
      <label className="lbl" htmlFor={id} style={{ display: 'block', marginTop: 10 }}>Or write your own</label>
      <input id={id} type="text" maxLength={200} value={own} onChange={(e) => setOwn(e.target.value)} />
      <div className="two">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn pri" disabled={busy || !own.trim()} onClick={() => onPick(own.trim())}>Send</button>
      </div>
    </div>
  )
}

function TaskCard({ sub, task, teen, decide }: { sub: Submission; task: Task | undefined; teen: TeenLite | undefined; decide: Decide }) {
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const name = teen?.nickname ?? 'your teen'
  const checkin = task?.proof_type === 'check-in'
  const run = async (args: Record<string, unknown>, done: string) => {
    if (busy) return
    setBusy(true)
    const ok = await decide('decide_submission', { p_id: sub.id, ...args }, done)
    if (!ok) setBusy(false)
  }
  return (
    <div className="card">
      <From teen={teen} what="Task" at={sub.submitted_at} />
      <div className="row"><b>{task?.title ?? 'Task'}</b><span className="chip">{task?.credits ?? 0} credits</span></div>
      <div className="lbl">Proof: {task ? PROOF_LABEL[task.proof_type] : '—'}{task?.repeats === 'weekly' ? ' · repeats weekly' : ''}</div>
      {sub.note && <div className="quote">“{sub.note}”</div>}
      {checkin && <p className="fine">You said you would check this one in person.</p>}
      {asking ? (
        <ReasonPicker reasons={TASK_REASONS} busy={busy} name={name} onCancel={() => setAsking(false)}
          onPick={(r) => run({ p_decision: 'not_yet', p_reason: r }, `Sent back with a kind reason. Nothing is lost, and ${name} can try again.`)} />
      ) : (
        <div className="two">
          <button type="button" className="btn pri" disabled={busy}
            onClick={() => run({ p_decision: 'approve' }, `Approved: +${task?.credits ?? 0} credits for ${name}.`)}>
            {busy ? 'Saving…' : checkin ? 'Checked, approve' : 'Approve'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setAsking(true)}>Not yet</button>
        </div>
      )}
    </div>
  )
}

function ShoutCard({ shout, teen, decide }: { shout: Shoutout; teen: TeenLite | undefined; decide: Decide }) {
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [other, setOther] = useState('')
  const name = teen?.nickname ?? 'your teen'
  const give = async (credits: number) => {
    if (busy) return
    setBusy(true)
    const ok = await decide('decide_shoutout', { p_id: shout.id, p_decision: 'approve', p_credits: credits },
      credits > 0 ? `Approved: +${credits} credits for ${name}.` : `Thanks sent to ${name}.`)
    if (!ok) setBusy(false)
  }
  const notYet = async (reason: string) => {
    if (busy) return
    setBusy(true)
    const ok = await decide('decide_shoutout', { p_id: shout.id, p_decision: 'not_yet', p_reason: reason }, `Sent back with a kind reason.`)
    if (!ok) setBusy(false)
  }
  const otherId = `other-${shout.id}`
  const otherN = Math.round(Number(other))
  return (
    <div className="card">
      <From teen={teen} what="Shout-out" at={shout.created_at} />
      <div className="quote">“{shout.text}”</div>
      <p className="fine">You choose the reward, or just say thanks.</p>
      {asking ? (
        <ReasonPicker reasons={SHOUT_REASONS} busy={busy} name={name} onCancel={() => setAsking(false)} onPick={notYet} />
      ) : (
        <>
          <div className="wrap">
            {[2, 5, 10].map((a) => <button key={a} type="button" className="btn sm" disabled={busy} onClick={() => give(a)}>+{a}</button>)}
            <button type="button" className="btn sm" disabled={busy} onClick={() => give(0)}>Thank you only</button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => setAsking(true)}>Not yet</button>
          </div>
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label className="lbl" htmlFor={otherId}>Other amount</label>
              <input id={otherId} type="number" inputMode="numeric" min={1} value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
            <button type="button" className="btn" disabled={busy || !(otherN > 0)} onClick={() => give(otherN)}>Give</button>
          </div>
        </>
      )}
    </div>
  )
}

function IdeaCard({ idea, teen, decide }: { idea: Idea; teen: TeenLite | undefined; decide: Decide }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(idea.title)
  const [credits, setCredits] = useState(String(idea.credits_asked))
  const name = teen?.nickname ?? 'your teen'
  const run = async (args: Record<string, unknown>, done: string) => {
    if (busy) return
    setBusy(true)
    const ok = await decide('decide_idea', { p_id: idea.id, ...args }, done)
    if (!ok) setBusy(false)
  }
  const tId = `it-${idea.id}`
  const cId = `ic-${idea.id}`
  return (
    <div className="card">
      <From teen={teen} what="Task idea" at={idea.created_at} />
      <div className="row"><b>Task idea from {name}</b><span className="chip">asks {idea.credits_asked} credits</span></div>
      <div className="quote">“{idea.title}”</div>
      {editing ? (
        <>
          <div className="two">
            <div><label className="lbl" htmlFor={tId}>Task name</label><input id={tId} type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><label className="lbl" htmlFor={cId}>Credits</label><input id={cId} type="number" inputMode="numeric" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} /></div>
          </div>
          <div className="two">
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn pri" disabled={busy || !title.trim() || !(Number(credits) >= 0)}
              onClick={() => run({ p_decision: 'approve', p_final_title: title.trim(), p_final_credits: Math.round(Number(credits)) },
                `Added for ${name}: ${title.trim()}, ${Math.round(Number(credits))} credits.`)}>
              Save and accept
            </button>
          </div>
        </>
      ) : (
        <div className="wrap">
          <button type="button" className="btn sm pri" disabled={busy}
            onClick={() => run({ p_decision: 'approve' }, `Added for ${name}: ${idea.title}, ${idea.credits_asked} credits.`)}>Accept</button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => setEditing(true)}>Edit and accept</button>
          <button type="button" className="btn sm" disabled={busy}
            onClick={() => run({ p_decision: 'decline' }, 'Declined with a kind note.')}>Decline</button>
        </div>
      )}
    </div>
  )
}
