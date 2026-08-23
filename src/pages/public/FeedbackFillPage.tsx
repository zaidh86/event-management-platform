import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, Star } from 'lucide-react'
import { getFeedbackForm, submitFeedback } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { Skeleton } from '../../components/ui/Skeleton'
import type { FeedbackForm, FeedbackQuestion } from '../../lib/types'

// Respondent-facing feedback form (/f/:formId). Visibility is RLS-scoped:
// anonymous visitors only ever see published PUBLIC forms; signed-in event
// members also see published participant forms. submit_feedback re-validates
// everything server-side (publish state, access, required answers).
//
// Feedback is GENERIC (00022): one form, one QR, any number of responses —
// the form's own questions carry context such as "which team is this about?".
export function FeedbackFillPage() {
  const { formId } = useParams<{ formId: string }>()
  const { session } = useAuth()
  const user = session?.user ?? null
  const [form, setForm] = useState<FeedbackForm | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'ok' | 'duplicate' | null>(null)
  const [doneMessage, setDoneMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!formId) return
    getFeedbackForm(formId)
      .then(setForm)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [formId])

  if (!loaded) return <div className="public-landing"><Skeleton lines={4} height="2rem" /></div>

  if (!form) {
    return (
      <div className="public-landing">
        <h1>Feedback</h1>
        <p className="muted">
          This feedback form is not available. It may not be published yet, or it
          may be open to event participants only{user ? '' : ' — try signing in'}.
        </p>
        {!user && <Link to="/login" className="btn btn-primary">Sign in</Link>}
      </div>
    )
  }

  const isReport = form?.kind === 'reflection'

  if (done) {
    return (
      <div className="public-landing">
        <p className="feedback-done">
          <CheckCircle2 size={28} aria-hidden />
        </p>
        <h1>{done === 'ok' ? 'Thank you!' : 'Already submitted'}</h1>
        <p className="muted">
          {done === 'ok'
            ? (isReport ? 'Your event report has been recorded.' : 'Your feedback has been recorded.')
            : doneMessage ?? 'You have already submitted this form.'}
        </p>
        {done === 'ok' && !isReport && (
          <button type="button" className="btn btn-ghost" onClick={() => { setAnswers({}); setDone(null); setBusy(false) }}>
            Submit another response
          </button>
        )}
      </div>
    )
  }

  function setAnswer(key: string, value: unknown) {
    setAnswers((a) => ({ ...a, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !form) return
    // client-side required check for immediate feedback; the server re-checks
    for (const q of form.questions) {
      if (!q.required) continue
      const v = answers[q.key]
      const empty = v == null
        || (typeof v === 'string' && v.trim() === '')
        || (Array.isArray(v) && v.length === 0)
      if (empty) {
        setError(`"${q.label}" is required`)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      const result = await submitFeedback(form.id, answers)
      setDone(result.status)
      setDoneMessage(result.message ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed')
      setBusy(false)
    }
  }

  return (
    <div className="public-landing public-landing-form">
      {isReport && <p className="step-kicker">Event Report</p>}
      <h1>{form.title}</h1>
      {form.description && <p className="muted">{form.description}</p>}
      <form className="stack card feedback-fill" onSubmit={(e) => void onSubmit(e)}>
        {form.questions.map((q) => (
          <QuestionField
            key={q.key}
            question={q}
            value={answers[q.key]}
            onChange={(v) => setAnswer(q.key, v)}
          />
        ))}
        {form.questions.length === 0 && (
          <p className="muted">This form has no questions yet.</p>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : isReport ? 'Submit event report' : 'Submit feedback'}
        </button>
      </form>
    </div>
  )
}

function QuestionField({ question: q, value, onChange }: {
  question: FeedbackQuestion
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = <>{q.label}{q.required && ' *'}</>

  if (q.type === 'short_text') {
    return (
      <label>{label}
        <input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={300} />
      </label>
    )
  }
  if (q.type === 'long_text') {
    return (
      <label>{label}
        <textarea value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={4} maxLength={4000} />
      </label>
    )
  }
  if (q.type === 'rating') {
    const max = Math.min(Math.max(q.max_rating ?? 5, 2), 10)
    const current = typeof value === 'number' ? value : 0
    return (
      <div className="rating-field">
        <span className="rating-label">{label}</span>
        <div className="rating-stars" role="radiogroup" aria-label={q.label}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n} type="button" role="radio" aria-checked={current === n}
              className={`rating-star ${n <= current ? 'rating-star-on' : ''}`}
              aria-label={`${n} of ${max}`}
              onClick={() => onChange(n)}
            >
              <Star size={22} aria-hidden fill={n <= current ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (q.type === 'single_choice') {
    return (
      <label>{label}
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    )
  }
  // multi_choice
  const selected = Array.isArray(value) ? (value as string[]) : []
  return (
    <fieldset className="qr-fieldset">
      <legend>{label}</legend>
      {(q.options ?? []).map((o) => (
        <label className="check" key={o}>
          <input
            type="checkbox"
            checked={selected.includes(o)}
            onChange={(e) =>
              onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))}
          />
          {o}
        </label>
      ))}
    </fieldset>
  )
}
