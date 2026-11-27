import { useEffect, useId, useRef, type ReactNode } from 'react'
import { AVATARS, avatarFor } from '../lib/avatars'

/** A labelled form field. The label is always tied to the input (screen readers). */
export function Field(props: {
  label: string
  hint?: string
  error?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const describedBy = [props.hint ? hintId : '', props.error ? errId : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children({ id, describedBy, invalid: Boolean(props.error) })}
      {props.hint && <div className="hint" id={hintId}>{props.hint}</div>}
      {props.error && <div className="err" id={errId} role="alert">{props.error}</div>}
    </div>
  )
}

/** Six-digit PIN box: numeric keypad on phones, hidden digits. */
export function PinInput(props: {
  id: string
  value: string
  onChange: (v: string) => void
  describedBy?: string
  invalid?: boolean
  autoComplete?: string
  autoFocus?: boolean
}) {
  return (
    <input
      id={props.id}
      className="pin"
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      autoComplete={props.autoComplete ?? 'off'}
      autoFocus={props.autoFocus}
      value={props.value}
      aria-describedby={props.describedBy}
      aria-invalid={props.invalid || undefined}
      onChange={(e) => props.onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  )
}

export function Avatar({ avatar, size = 44 }: { avatar: string; size?: number }) {
  const a = avatarFor(avatar)
  return (
    <span className="av" style={{ width: size, height: size, background: a.bg, fontSize: size * 0.55 }} role="img" aria-label={a.label}>
      <span aria-hidden="true">{a.emoji}</span>
    </span>
  )
}

export function AvatarPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field" role="group" aria-labelledby="avatar-label">
      <div className="label" id="avatar-label">Avatar</div>
      <div className="avatars">
        {AVATARS.map((a) => (
          <button
            type="button"
            key={a.key}
            aria-pressed={value === a.key}
            aria-label={a.label}
            onClick={() => onChange(a.key)}
            style={{ fontSize: 30 }}
          >
            <span aria-hidden="true">{a.emoji}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Bottom sheet built on <dialog>: focus is trapped and Escape closes it. */
export function Sheet(props: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) d.showModal()
    if (!props.open && d.open) d.close()
  }, [props.open])
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={props.onClose}
      onClick={(e) => { if (e.target === ref.current) props.onClose() }}
    >
      <div>
        <h2 id={titleId}>{props.title}</h2>
        {props.children}
      </div>
    </dialog>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="spinner" role="status" aria-live="polite">{label}</div>
}
