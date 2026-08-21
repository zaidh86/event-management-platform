import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, Plus } from 'lucide-react'
import {
  countFeedbackResponses, createFeedbackForm, createQrConfig, deleteFeedbackForm,
  listFeedbackForms, listFeedbackResponses, listQrConfigs, updateFeedbackForm,
} from '../../lib/api'
import { publicQrUrl } from '../../lib/qr'
import { QRCodeSVG } from 'qrcode.react'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useEvent } from './EventLayout'
import type {
  FeedbackForm, FeedbackQuestion, FeedbackQuestionType, FeedbackResponse, QrConfig,
} from '../../lib/types'

// Event Manager feedback surface (ADR-0009): create forms, configure questions,
// publish, hand out a public QR, review responses. Respondents use /f/:formId.
// kind='feedback' is the Feedback tab; kind='reflection' is the participant
// EVENT REPORT engine (same infrastructure, separated product surface —
// Informatique Exhib pass, issue 8) and is embedded in Analytics.
export function FeedbackPage() {
  const { canManageEvent } = useEvent()
  if (!canManageEvent) {
    return (
      <div className="page">
        <p className="form-error">Only Event Managers can manage feedback forms.</p>
      </div>
    )
  }
  return (
    <div className="page page-narrow">
      <FeedbackManager kind="feedback" />
    </div>
  )
}

export function FeedbackManager({ kind }: { kind: 'feedback' | 'reflection' }) {
  const { event, canManageEvent, refresh } = useEvent()
  const isReport = kind === 'reflection'
  const toast = useToast()
  const [forms, setForms] = useState<FeedbackForm[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [qrConfigs, setQrConfigs] = useState<QrConfig[]>([])
  const [editing, setEditing] = useState<FeedbackForm | 'new' | null>(null)
  const [viewing, setViewing] = useState<FeedbackForm | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FeedbackForm | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    listFeedbackForms(event.id)
      .then(async (fs0) => {
        const fs = fs0.filter((f) => (f.kind ?? 'feedback') === kind)
        setForms(fs)
        const entries = await Promise.all(
          fs.map(async (f) => [f.id, await countFeedbackResponses(f.id).catch(() => 0)] as const),
        )
        setCounts(Object.fromEntries(entries))
      })
      .catch(() => setForms([]))
    listQrConfigs(event.id).then(setQrConfigs).catch(() => {})
  }, [event.id, kind])

  useEffect(() => { reload() }, [reload])

  if (!canManageEvent) return null

  async function setStatus(form: FeedbackForm, status: FeedbackForm['status']) {
    try {
      await updateFeedbackForm(form.id, { status })
      toast('success', status === 'published' ? `"${form.title}" published` : `"${form.title}" ${status}`)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await deleteFeedbackForm(confirmDelete.id)
      toast('success', `"${confirmDelete.title}" deleted`)
      setConfirmDelete(null)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Delete failed')
      setConfirmDelete(null)
    } finally {
      setBusy(false)
    }
  }

  // one-click feedback QR: creates (or reveals) the QR operation for this form
  async function ensureQr(form: FeedbackForm) {
    const existing = qrConfigs.find(
      (c) => c.target === 'feedback' && c.config.feedback_form_id === form.id,
    )
    if (existing) return existing
    try {
      const created = await createQrConfig({
        event_id: event.id,
        label: `Feedback — ${form.title}`,
        description: 'Scan to open the feedback form.',
        target: 'feedback',
        actions: ['feedback'],
        scanner_access: form.access === 'public' ? ['public'] : ['participant'],
        config: { feedback_form_id: form.id },
      } as Partial<QrConfig> & { event_id: string; label: string; target: string; actions: string[] })
      toast('success', 'Feedback QR created')
      reload()
      await refresh()
      return created
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not create QR')
      return null
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h2>{isReport ? 'Event reports' : 'Feedback'}</h2>
        {!editing && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden /> {isReport ? 'New event report form' : 'New form'}
          </button>
        )}
      </div>
      {isReport && (
        <p className="muted">
          Participants fill their event report from My Dashboard after taking
          part; responses feed the analytics and the printable event report.
        </p>
      )}

      {editing && (
        <FormEditor
          eventId={event.id}
          kind={kind}
          form={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null)
            reload()
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {!editing && forms === null && <Skeleton lines={3} height="3rem" />}
      {!editing && forms !== null && forms.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title={isReport ? 'No event report forms yet' : 'No feedback forms yet'}
          hint={isReport
            ? 'Create the questions participants answer in their event report.'
            : 'Create a form, publish it, and share its QR with participants or the public.'}
        />
      )}

      {!editing && forms?.map((f) => (
        <div className="card stack feedback-form-card" key={f.id}>
          <div className="feedback-form-head">
            <div>
              <h3>{f.title}</h3>
              <p className="muted">
                <span className={`badge badge-${f.status === 'published' ? 'active' : f.status === 'draft' ? 'draft' : 'ended'}`}>{f.status}</span>
                {f.access === 'public' ? 'Public' : 'Participants only'}
                {' · '}{f.questions.length} question{f.questions.length === 1 ? '' : 's'}
                {' · '}{counts[f.id] ?? 0} response{(counts[f.id] ?? 0) === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <div className="row">
            {f.status !== 'published' && (
              <button className="btn btn-primary btn-sm" onClick={() => void setStatus(f, 'published')}>Publish</button>
            )}
            {f.status === 'published' && (
              <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(f, 'closed')}>Close</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(f)}>Edit</button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setViewing(viewing?.id === f.id ? null : f)}
            >
              {viewing?.id === f.id ? 'Hide responses' : 'View responses'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(f)}>Delete</button>
          </div>
          <FeedbackQrBlock
            form={f}
            config={qrConfigs.find((c) => c.target === 'feedback' && c.config.feedback_form_id === f.id) ?? null}
            onCreate={() => void ensureQr(f)}
          />
          {viewing?.id === f.id && <ResponsesViewer form={f} />}
        </div>
      ))}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        confirmLabel="Delete form"
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      >
        <p className="muted">
          The form and <strong>all of its responses</strong> are deleted
          permanently. Close the form instead if you want to keep the responses.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function FeedbackQrBlock({ form, config, onCreate }: {
  form: FeedbackForm
  config: QrConfig | null
  onCreate: () => void
}) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  if (!config) {
    return (
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCreate} disabled={form.status !== 'published'}>
          Create feedback QR
        </button>
        {form.status !== 'published' && <span className="muted">Publish the form first.</span>}
      </div>
    )
  }
  const url = publicQrUrl(config.qr_token)
  return (
    <div className="qr-public-preview">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide QR' : 'Show feedback QR'}
      </button>
      <button
        type="button" className="btn btn-ghost btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(url)
            .then(() => toast('success', 'Link copied'))
            .catch(() => setOpen(true))
        }}
      >
        Copy link
      </button>
      {!config.is_enabled && <span className="muted">This QR is currently disabled (see Event settings → QR operations).</span>}
      {open && (
        <div className="qr-public-box">
          <QRCodeSVG value={url} size={180} marginSize={2} />
          <code className="qr-token">{url}</code>
        </div>
      )}
    </div>
  )
}

// ---- builder -----------------------------------------------------------------

const QUESTION_TYPES: { value: FeedbackQuestionType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'rating', label: 'Rating' },
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multi_choice', label: 'Multiple choice' },
]

function FormEditor({ eventId, kind, form, onDone, onCancel }: {
  eventId: string
  kind: 'feedback' | 'reflection'
  form: FeedbackForm | null
  onDone: () => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState(form?.title ?? '')
  const [description, setDescription] = useState(form?.description ?? '')
  const [access, setAccess] = useState<FeedbackForm['access']>(form?.access ?? 'participants')
  const [onePerUser, setOnePerUser] = useState(form?.one_response_per_user ?? true)
  const [questions, setQuestions] = useState<FeedbackQuestion[]>(form?.questions ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function patch(i: number, fields: Partial<FeedbackQuestion>) {
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...fields } : q)))
  }

  async function save() {
    if (busy) return
    if (title.trim() === '') {
      setError('Give the form a title')
      return
    }
    const clean = questions
      .filter((q) => q.label.trim() !== '')
      .map((q, i) => ({
        ...q,
        key: q.key || `q${i + 1}_${q.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)}`,
        options: q.type === 'single_choice' || q.type === 'multi_choice'
          ? (q.options ?? []).filter((o) => o.trim() !== '')
          : undefined,
        max_rating: q.type === 'rating' ? Math.min(Math.max(q.max_rating ?? 5, 2), 10) : undefined,
      }))
    setBusy(true)
    setError(null)
    try {
      if (form) {
        await updateFeedbackForm(form.id, {
          title: title.trim(), kind, description: description.trim(),
          access, one_response_per_user: onePerUser, questions: clean,
        })
        toast('success', 'Form updated')
      } else {
        await createFeedbackForm({
          event_id: eventId, title: title.trim(), kind, description: description.trim(),
          access, one_response_per_user: onePerUser, questions: clean,
        })
        toast('success', 'Form created')
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <div className="card stack">
      <h3>{form ? 'Edit form' : kind === 'reflection' ? 'New event report form' : 'New feedback form'}</h3>
      {form?.status === 'published' && (
        <p className="muted">
          This form is live — changing questions affects how existing responses
          line up with them.
        </p>
      )}
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
      </label>
      <label>
        Who can respond
        <select value={access} onChange={(e) => setAccess(e.target.value as FeedbackForm['access'])}>
          <option value="participants">Event participants (sign-in required)</option>
          <option value="public">Public — anyone with the link or QR</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={onePerUser} onChange={(e) => setOnePerUser(e.target.checked)} />
        One response per signed-in user
      </label>
      {access === 'public' && onePerUser && (
        <p className="muted">
          Anonymous public responses cannot be limited per person — the limit
          applies to signed-in respondents.
        </p>
      )}
      {onePerUser && (
        <p className="muted">
          When the form is opened for a specific team or participant (e.g. via a
          scanned QR), the limit applies per person per target.
        </p>
      )}

      <h3>Questions</h3>
      {questions.map((q, i) => (
        <div className="field-row" key={i}>
          <input
            placeholder="Question" value={q.label}
            onChange={(e) => patch(i, { label: e.target.value })}
          />
          <select value={q.type} onChange={(e) => patch(i, { type: e.target.value as FeedbackQuestionType })}>
            {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {(q.type === 'single_choice' || q.type === 'multi_choice') && (
            <input
              placeholder="Options, comma-separated"
              value={(q.options ?? []).join(',')}
              onChange={(e) => patch(i, { options: e.target.value.split(',') })}
            />
          )}
          {q.type === 'rating' && (
            <input
              type="number" min={2} max={10} value={q.max_rating ?? 5}
              aria-label="Maximum rating"
              onChange={(e) => patch(i, { max_rating: Number(e.target.value) })}
            />
          )}
          <label className="check">
            <input type="checkbox" checked={q.required} onChange={(e) => patch(i, { required: e.target.checked })} />
            Required
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button" className="btn btn-ghost btn-sm"
        onClick={() => setQuestions((qs) => [...qs, { key: '', label: '', type: 'short_text', required: false }])}
      >
        + Add question
      </button>

      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : form ? 'Save form' : 'Create form'}
        </button>
      </div>
    </div>
  )
}

// ---- responses ---------------------------------------------------------------

function ResponsesViewer({ form }: { form: FeedbackForm }) {
  const [responses, setResponses] = useState<FeedbackResponse[] | null>(null)

  useEffect(() => {
    listFeedbackResponses(form.id).then(setResponses).catch(() => setResponses([]))
  }, [form.id])

  if (responses === null) return <Skeleton lines={2} height="2rem" />
  if (responses.length === 0) return <p className="muted">No responses yet.</p>

  return (
    <div className="table-scroll">
      <table className="responses-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Respondent</th>
            {form.questions.map((q) => <th key={q.key}>{q.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {responses.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.respondent_id ? 'Signed-in' : 'Anonymous'}</td>
              {form.questions.map((q) => (
                <td key={q.key}>{formatAnswer(r.answers[q.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatAnswer(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}
