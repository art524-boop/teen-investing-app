import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { errorText } from '../lib/api'
import { Field, Sheet } from './ui'

/** Every screen: the practice banner, the content, and the feedback button. */
export function Layout({ side, title, tabs, children }: { side: 'parent' | 'teen' | 'neutral'; title: string; tabs?: ReactNode; children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    document.title = `${title} · Teen Investing (practice)`
  }, [title])
  return (
    <div className={`app ${side === 'teen' ? 'teen' : ''} ${tabs ? 'has-tabs' : ''}`}>
      <div className="banner" role="note">
        <b>Practice app</b> — no real money
      </div>
      <main className="scr" ref={mainRef} id="main">
        {children}
      </main>
      <FeedbackButton screen={title} />
      {tabs}
    </div>
  )
}

function FeedbackButton({ screen }: { screen: string }) {
  const { session } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.from('feedback').insert({ screen: `${screen} (${location.pathname})`.slice(0, 60), text: text.trim() })
    setBusy(false)
    if (error) {
      setMsg({ ok: false, text: errorText(error) })
    } else {
      setText('')
      setMsg({ ok: true, text: 'Thanks! Your feedback was sent.' })
    }
  }

  return (
    <>
      <button type="button" className="fb-btn" onClick={() => { setMsg(null); setOpen(true) }}>
        Feedback
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Send feedback">
        {session ? (
          <>
            <p className="fine" style={{ marginTop: 0 }}>Tell us what's confusing, broken or great on this screen.</p>
            <Field label="Your feedback">
              {({ id }) => (
                <textarea id={id} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
              )}
            </Field>
            {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
            <div className="two">
              <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
              <button type="button" className="btn pri" disabled={busy || !text.trim()} onClick={send}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Please log in first, so we know which family the feedback is from.</p>
            <button type="button" className="btn wide" onClick={() => setOpen(false)}>Close</button>
          </>
        )}
      </Sheet>
    </>
  )
}
