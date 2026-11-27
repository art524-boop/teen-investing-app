import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { ParentTabs } from '../../components/Tabs'
import { Avatar, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { errorText } from '../../lib/api'
import { PROOF_LABEL, fmtDue, useFamily, type Proof, type Task } from '../../lib/familyData'

const CATEGORIES = ['Home', 'Study', 'Money skills', 'Outdoors', 'Helping out']

interface Draft {
  title: string
  category: string
  credits: string
  repeats: 'none' | 'weekly'
  proof_type: Proof
  due_date: string
}
const blank: Draft = { title: '', category: 'Home', credits: '5', repeats: 'weekly', proof_type: 'none', due_date: '' }
const fromTask = (t: Task): Draft => ({
  title: t.title, category: t.category, credits: String(t.credits), repeats: t.repeats, proof_type: t.proof_type, due_date: t.due_date ?? '',
})

function check(d: Draft): string {
  if (!d.title.trim()) return 'Give the task a name first.'
  const n = Number(d.credits)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return 'Credits must be a whole number, 0 or more.'
  return ''
}
const toRow = (d: Draft) => ({
  title: d.title.trim(), category: d.category.trim() || 'Home', credits: Number(d.credits), repeats: d.repeats,
  proof_type: d.proof_type, due_date: d.due_date || null,
})

/** Family settings → Tasks: add, edit and archive tasks for each teen. */
export default function FamilySettings() {
  const { loading, error, teens, tasks, reload } = useFamily()
  useEffect(() => { void reload() }, [reload]) // fresh data whenever this tab opens
  const [teenId, setTeenId] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!teenId && teens.length) setTeenId(teens[0].id)
  }, [teens, teenId])

  const teen = teens.find((t) => t.id === teenId)
  const mine = tasks.filter((t) => t.teen_id === teenId)
  const active = mine.filter((t) => t.status !== 'archived')
  const archived = mine.filter((t) => t.status === 'archived')

  const save = async (id: string | null, d: Draft) => {
    const problem = check(d)
    if (problem) return problem
    const { error } = id
      ? await supabase.from('tasks').update(toRow(d)).eq('id', id)
      : await supabase.from('tasks').insert({ teen_id: teenId, ...toRow(d) })
    if (error) return errorText(error)
    setMsg({ ok: true, text: id ? 'Task saved.' : `Task added. ${teen?.nickname ?? 'Your teen'} can see it now.` })
    setEditing(null)
    setAdding(false)
    await reload()
    return ''
  }

  const setStatus = async (t: Task, status: 'archived' | 'open') => {
    setMsg(null)
    const { error } = await supabase.from('tasks').update({ status }).eq('id', t.id)
    if (error) return setMsg({ ok: false, text: errorText(error) })
    setMsg({ ok: true, text: status === 'archived' ? `Archived “${t.title}”.` : `Restored “${t.title}”.` })
    await reload()
  }

  return (
    <Layout side="parent" title="Family settings" tabs={<ParentTabs />}>
      <h1>Family settings</h1>
      {loading && <Spinner />}
      {error && <p className="err" role="alert">{error}</p>}
      {!loading && teens.length === 0 && (
        <div className="card">
          <p style={{ marginTop: 0 }}>Add your teen first, then set up their tasks here.</p>
          <Link className="btn pri wide" to="/parent/add-teen">Add a teen</Link>
        </div>
      )}
      {teens.length > 1 && (
        <div className="chips" role="group" aria-label="Choose a teen">
          {teens.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === teenId} onClick={() => { setTeenId(t.id); setEditing(null); setAdding(false) }}>
              {t.nickname}
            </button>
          ))}
        </div>
      )}
      {teen && (
        <div className="card">
          <div className="row start" style={{ gap: 10 }}>
            <Avatar avatar={teen.avatar} size={36} />
            <b>{teen.nickname}'s tasks</b>
          </div>
          <p className="fine">Suggested: 5 to 15 credits for chores. A suggestion, not a rule — there's no cap.</p>
          <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}</div>
          {active.length === 0 && <p className="fine">No tasks yet.</p>}
          {active.map((t) => editing === t.id ? (
            <TaskForm key={t.id} initial={fromTask(t)} submitLabel="Save task" onCancel={() => setEditing(null)} onSave={(d) => save(t.id, d)}
              extra={<button type="button" className="btn wide" onClick={() => setStatus(t, 'archived')}>Archive this task</button>} />
          ) : (
            <div className="trow" key={t.id}>
              <div className="row">
                <span><b style={{ fontWeight: 600 }}>{t.title}</b></span>
                <span className="chip">{t.credits} credits</span>
              </div>
              <div className="lbl">
                {t.category} · {t.repeats === 'weekly' ? 'repeats weekly' : 'one-off'} · proof: {PROOF_LABEL[t.proof_type]}
                {t.due_date ? ` · due ${fmtDue(t.due_date)}` : ''}
                {t.status === 'submitted' ? ' · waiting for you' : t.status === 'done' ? (t.repeats === 'weekly' ? ' · done, back Monday' : ' · done') : ''}
              </div>
              <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => { setEditing(t.id); setAdding(false); setMsg(null) }}
                aria-label={`Edit ${t.title}`}>Edit</button>
            </div>
          ))}
          {adding ? (
            <TaskForm initial={blank} submitLabel="Add task" onCancel={() => setAdding(false)} onSave={(d) => save(null, d)} />
          ) : (
            <button type="button" className="btn pri wide" onClick={() => { setAdding(true); setEditing(null); setMsg(null) }}>Add a task</button>
          )}
          {archived.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>Archived tasks ({archived.length})</summary>
              {archived.map((t) => (
                <div className="trow row" key={t.id}>
                  <span>{t.title}</span>
                  <button type="button" className="btn sm" onClick={() => setStatus(t, 'open')} aria-label={`Restore ${t.title}`}>Restore</button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      <p className="fine">More family settings (milestones, module credits, showing real values) arrive in later stages.</p>
    </Layout>
  )
}

function TaskForm({ initial, submitLabel, onSave, onCancel, extra }: {
  initial: Draft; submitLabel: string; onSave: (d: Draft) => Promise<string>; onCancel: () => void; extra?: ReactNode
}) {
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(await onSave(d))
    setBusy(false)
  }
  return (
    <form className="trow" onSubmit={submit} noValidate>
      <div className="field" style={{ marginTop: 4 }}>
        <label htmlFor="tf-title">Task</label>
        <input id="tf-title" type="text" maxLength={80} value={d.title} onChange={(e) => set('title', e.target.value)} autoFocus />
      </div>
      <div className="two">
        <div>
          <label className="lbl" htmlFor="tf-credits">Credits</label>
          <input id="tf-credits" type="number" inputMode="numeric" min={0} value={d.credits} onChange={(e) => set('credits', e.target.value)} />
        </div>
        <div>
          <label className="lbl" htmlFor="tf-cat">Category</label>
          <input id="tf-cat" type="text" list="tf-cats" maxLength={30} value={d.category} onChange={(e) => set('category', e.target.value)} />
          <datalist id="tf-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <div className="field" role="group" aria-labelledby="tf-rep-l">
        <div className="label" id="tf-rep-l">Repeats</div>
        <div className="seg two-up">
          <button type="button" aria-pressed={d.repeats === 'weekly'} onClick={() => set('repeats', 'weekly')}>Every week</button>
          <button type="button" aria-pressed={d.repeats === 'none'} onClick={() => set('repeats', 'none')}>One-off</button>
        </div>
      </div>
      <div className="field" role="group" aria-labelledby="tf-proof-l">
        <div className="label" id="tf-proof-l">Proof</div>
        <div className="seg three-up">
          {(['none', 'note', 'check-in'] as Proof[]).map((p) => (
            <button key={p} type="button" aria-pressed={d.proof_type === p} onClick={() => set('proof_type', p)}>{PROOF_LABEL[p]}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="tf-due">Due date (optional)</label>
        <input id="tf-due" type="date" value={d.due_date} onChange={(e) => set('due_date', e.target.value)} />
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="two">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
      {extra}
    </form>
  )
}
