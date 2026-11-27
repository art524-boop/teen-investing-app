import { useEffect, useState, type FormEvent } from 'react'
import { Layout } from '../../components/Layout'
import { TeenTabs } from '../../components/Tabs'
import { Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { errorText } from '../../lib/api'
import { PROOF_LABEL, fmtDue, latestSubmission, useFamily, type Task } from '../../lib/familyData'

export default function TeenTasks() {
  const { loading, error, tasks, submissions, ideas, shoutouts, parentName, reload, markDecisionsSeen, newDecisions } = useFamily()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Opening Tasks clears the "new decisions" badge.
  useEffect(() => { if (newDecisions > 0) markDecisionsSeen() }, [newDecisions, markDecisionsSeen])

  const visible = tasks.filter((t) => t.status !== 'archived')
  const todo = visible.filter((t) => t.status === 'open')
  const waiting = visible.filter((t) => t.status === 'submitted')
  const done = visible.filter((t) => t.status === 'done')

  return (
    <Layout side="teen" title="Tasks" tabs={<TeenTabs />}>
      <h1>Tasks</h1>
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}</div>
      {loading && <Spinner />}
      {error && <p className="err" role="alert">{error}</p>}
      {!loading && visible.length === 0 && <div className="card lock"><p className="fine" style={{ margin: 0 }}>No tasks yet. Suggest one below!</p></div>}

      {todo.map((t) => (
        <TodoCard key={t.id} task={t} parentName={parentName} last={latestSubmission(submissions, t.id)}
          onSent={async (text) => { setMsg({ ok: true, text }); await reload() }}
          onError={(text) => setMsg({ ok: false, text })} />
      ))}

      {waiting.length > 0 && <span className="sec">Waiting for {parentName}</span>}
      {waiting.map((t) => {
        const s = latestSubmission(submissions, t.id)
        return (
          <div className="card" key={t.id}>
            <div className="row"><b>{t.title}</b><span className="chip">+{t.credits}</span></div>
            {s?.note && <div className="quote">“{s.note}”</div>}
            <div style={{ marginTop: 8 }}><span className="chip wait">Waiting for {parentName}</span></div>
          </div>
        )
      })}

      {done.length > 0 && <span className="sec">Done</span>}
      {done.map((t) => {
        const s = latestSubmission(submissions, t.id)
        return (
          <div className="card lock" key={t.id}>
            <div className="row"><b>{t.title}</b><span className="chip ok">Approved · +{s?.credits_given ?? t.credits}</span></div>
            <div className="lbl">{t.repeats === 'weekly' ? 'Back on Monday for next week' : 'One-off, all finished'}</div>
          </div>
        )
      })}

      <SuggestCard parentName={parentName} ideas={ideas} onSent={reload} />
      <ShoutCard parentName={parentName} shoutouts={shoutouts} onSent={reload} />
    </Layout>
  )
}

function TodoCard({ task, parentName, last, onSent, onError }: {
  task: Task; parentName: string; last: ReturnType<typeof latestSubmission>
  onSent: (text: string) => Promise<void>; onError: (text: string) => void
}) {
  const notYet = last?.decision === 'not_yet'
  const [doing, setDoing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteId = `note-${task.id}`

  const send = async () => {
    if (busy) return
    if (task.proof_type === 'note' && !note.trim()) return onError(`Add a short note for ${parentName} first.`)
    setBusy(true)
    const { error } = await supabase.from('task_submissions').insert({ task_id: task.id, note: note.trim() || null })
    setBusy(false)
    if (error) return onError(errorText(error))
    setDoing(false)
    setNote('')
    await onSent(`Sent to ${parentName} for approval.`)
  }
  const start = () => {
    if (task.proof_type === 'none') void send()
    else setDoing(true)
  }

  const showNotYet = notYet && !retrying
  return (
    <div className="card">
      <div className="row"><b>{task.title}</b><span className="chip">+{task.credits}</span></div>
      <div className="lbl">{task.category} · {task.repeats === 'weekly' ? 'repeats weekly' : 'one-off'} · proof: {PROOF_LABEL[task.proof_type]}</div>
      {task.due_date && <div className="lbl">Due {fmtDue(task.due_date)} · no penalty if it's late</div>}
      {showNotYet ? (
        <>
          <div style={{ marginTop: 8 }}><span className="chip no">Not yet</span></div>
          <div className="quote">{parentName}: {last?.reason}</div>
          <p className="fine">Nothing is lost. Have another go whenever you're ready.</p>
          <button type="button" className="btn pri wide" onClick={() => setRetrying(true)}>Try again</button>
        </>
      ) : doing ? (
        <>
          {task.proof_type === 'note' && (
            <>
              <label className="lbl" htmlFor={noteId} style={{ display: 'block', marginTop: 10 }}>Tell {parentName} what you did</label>
              <input id={noteId} type="text" maxLength={500} placeholder="I…" value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
            </>
          )}
          {task.proof_type === 'check-in' && <p className="fine">{parentName} will check this one in person.</p>}
          <div className="two">
            <button type="button" className="btn" onClick={() => setDoing(false)}>Cancel</button>
            <button type="button" className="btn pri" disabled={busy} onClick={send}>{busy ? 'Sending…' : `Send to ${parentName}`}</button>
          </div>
        </>
      ) : (
        <button type="button" className="btn pri wide" disabled={busy} onClick={start}>Mark as done</button>
      )}
    </div>
  )
}

function SuggestCard({ parentName, ideas, onSent }: { parentName: string; ideas: ReturnType<typeof useFamily>['ideas']; onSent: () => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [credits, setCredits] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setMsg({ ok: false, text: 'Give the task idea a name first.' })
    const n = credits.trim() === '' ? 5 : Math.round(Number(credits))
    if (!(n >= 0)) return setMsg({ ok: false, text: 'Credits must be 0 or more.' })
    setBusy(true)
    const { error } = await supabase.from('task_ideas').insert({ title: title.trim(), credits_asked: n })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errorText(error) })
    setTitle('')
    setCredits('')
    setMsg({ ok: true, text: `Idea sent to ${parentName}.` })
    await onSent()
  }
  return (
    <>
      <span className="sec">Suggest a task</span>
      <form className="card" onSubmit={submit} noValidate>
        <label className="lbl" htmlFor="sugT">Got an idea for a task? {parentName} decides.</label>
        <input id="sugT" type="text" maxLength={80} placeholder="Wash the dog" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 6 }} />
        <label className="lbl" htmlFor="sugV" style={{ display: 'block', marginTop: 8 }}>Credits you'd suggest</label>
        <input id="sugV" type="number" inputMode="numeric" min={0} placeholder="8" value={credits} onChange={(e) => setCredits(e.target.value)} />
        <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}</div>
        <button type="submit" className="btn pri wide" disabled={busy}>{busy ? 'Sending…' : 'Send idea'}</button>
        {ideas.slice(0, 10).map((i) => (
          <div className="act" key={i.id}>
            <div className="row">
              <span>{i.final_title ?? i.title}</span>
              {i.status === 'approved' ? <span className="chip ok">Added · {i.final_credits} credits</span>
                : i.status === 'declined' ? <span className="chip">Not this time</span>
                : <span className="chip wait">Waiting</span>}
            </div>
            {i.status === 'declined' && <p className="fine">{parentName}: Thanks for the idea. Let's keep it for another time.</p>}
          </div>
        ))}
      </form>
    </>
  )
}

function ShoutCard({ parentName, shoutouts, onSent }: { parentName: string; shoutouts: ReturnType<typeof useFamily>['shoutouts']; onSent: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return setMsg({ ok: false, text: 'Write a few words first.' })
    setBusy(true)
    const { error } = await supabase.from('shoutouts').insert({ text: text.trim() })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errorText(error) })
    setText('')
    setMsg({ ok: true, text: `Shout-out sent to ${parentName}.` })
    await onSent()
  }
  return (
    <>
      <span className="sec">Shout-outs</span>
      <form className="card" onSubmit={submit} noValidate>
        <label className="lbl" htmlFor="shoutTxt">Did something good on your own? Tell {parentName}.</label>
        <input id="shoutTxt" type="text" maxLength={280} placeholder="I helped…" value={text} onChange={(e) => setText(e.target.value)} style={{ marginTop: 6 }} />
        <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}</div>
        <button type="submit" className="btn pri wide" disabled={busy}>{busy ? 'Sending…' : 'Send shout-out'}</button>
      </form>
      {shoutouts.slice(0, 10).map((s) => (
        <div className="card" key={s.id}>
          <div className="quote" style={{ margin: 0 }}>“{s.text}”</div>
          <div style={{ marginTop: 8 }}>
            {s.status === 'approved'
              ? <span className="chip ok">{(s.credits_given ?? 0) > 0 ? `${parentName} added ${s.credits_given} credits` : `${parentName} said thanks`}</span>
              : s.status === 'not_yet' ? <span className="chip">Not yet</span>
              : <span className="chip wait">Waiting for {parentName}</span>}
          </div>
          {s.status === 'not_yet' && s.reason && <p className="fine">{parentName}: {s.reason}</p>}
        </div>
      ))}
    </>
  )
}
