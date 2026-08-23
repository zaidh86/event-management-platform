import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, Plus, Sparkles } from 'lucide-react'
import {
  analyzeFeedbackWithAi, countFeedbackResponses, createFeedbackForm, createQrConfig,
  deleteFeedbackForm, listFeedbackForms, listFeedbackResponses, listQrConfigs,
  updateFeedbackForm,
} from '../../lib/api'
import { publicQrUrl } from '../../lib/qr'
import { QRCodeSVG } from 'qrcode.react'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useEvent } from './EventLayout'
import type {
  AiFeedbackAnalysis, FeedbackForm, FeedbackQuestion, FeedbackQuestionType, FeedbackResponse,
  QrConfig,
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
          access, one_response_per_user: false, questions: clean,
        })
        toast('success', 'Form updated')
      } else {
        await createFeedbackForm({
          event_id: eventId, title: title.trim(), kind, description: description.trim(),
          access, one_response_per_user: false, questions: clean,
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
      {kind === 'feedback' && (
        <p className="muted">
          This is a generic form: one QR, one link, and respondents may answer as
          many times as they like. Add a question such as “Which team is this
          feedback about?” if you want responses to carry that context.
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

// Audience segregation (00021). The bucket comes from the STORED
// respondent_category, stamped server-side against the event's own club at
// submission time — never re-derived here, so a later role change cannot
// retroactively relabel old feedback.
//
// 'other' deliberately holds two different unknowns: anonymous respondents
// (unattributable by design) and rows recorded before 00021 existed (null).
// Neither is evidence of "not faculty", so neither is folded into Regular.
type Audience = 'all' | 'faculty' | 'regular' | 'other'

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'regular', label: 'Regular' },
  { value: 'other', label: 'Other' },
]

function audienceOf(r: FeedbackResponse): Exclude<Audience, 'all'> {
  if (r.respondent_category === 'faculty') return 'faculty'
  if (r.respondent_category === 'regular') return 'regular'
  return 'other'
}

function ResponsesViewer({ form }: { form: FeedbackForm }) {
  const [responses, setResponses] = useState<FeedbackResponse[] | null>(null)
  const [audience, setAudience] = useState<Audience>('all')
  const [analysis, setAnalysis] = useState<AiFeedbackAnalysis | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  async function runAnalysis() {
    setAiBusy(true)
    setAiError(null)
    try {
      setAnalysis(await analyzeFeedbackWithAi(form.id))
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI analysis is temporarily unavailable.')
    } finally {
      setAiBusy(false)
    }
  }

  useEffect(() => {
    listFeedbackResponses(form.id).then(setResponses).catch(() => setResponses([]))
  }, [form.id])

  if (responses === null) return <Skeleton lines={2} height="2rem" />
  if (responses.length === 0) return <p className="muted">No responses yet.</p>

  const counts = { all: responses.length, faculty: 0, regular: 0, other: 0 }
  for (const r of responses) counts[audienceOf(r)] += 1
  const shown = audience === 'all' ? responses : responses.filter((r) => audienceOf(r) === audience)

  return (
    <div className="stack">
      <div className="filter-chips print-hide" role="group" aria-label="Filter responses by audience">
        {AUDIENCES.map((a) => (
          <button
            key={a.value}
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={audience === a.value}
            onClick={() => setAudience(a.value)}
          >
            {a.label} <span className="chip-count">{counts[a.value]}</span>
          </button>
        ))}
      </div>
      {counts.other > 0 && (
        <p className="muted">
          <strong>Other</strong> covers anonymous responses and responses recorded
          before faculty segregation was added — neither can be classified.
        </p>
      )}
      <div className="ai-panel print-hide">
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" disabled={aiBusy} onClick={() => void runAnalysis()}>
            <Sparkles size={14} aria-hidden /> {aiBusy ? 'Analyzing…' : analysis ? 'Re-run AI summary' : 'Summarize with AI'}
          </button>
          <span className="muted">
            Sends only the answers (no names, emails or identities) to the AI
            service and returns an organizer summary. Nothing is stored.
          </span>
        </div>
        {aiError && (
          <p className="form-error">
            {aiError} — AI analysis is temporarily unavailable; the responses above are complete and readable as usual.
          </p>
        )}
        {analysis && <FeedbackAnalysisView analysis={analysis} />}
      </div>
      {shown.length === 0 ? (
        <p className="muted">No responses in this group.</p>
      ) : (
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
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>
                    {r.respondent_id ? 'Signed-in' : 'Anonymous'}
                    {r.respondent_category === 'faculty' && (
                      <span className="badge badge-faculty">Faculty</span>
                    )}
                  </td>
                  {form.questions.map((q) => (
                    <td key={q.key}>{formatAnswer(r.answers[q.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FeedbackAnalysisView({ analysis }: { analysis: AiFeedbackAnalysis }) {
  const list = (items: string[]) => items.length === 0
    ? <p className="muted">—</p>
    : <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
  return (
    <div className="ai-analysis">
      <p className="muted">
        AI summary of {analysis.response_count} response{analysis.response_count === 1 ? '' : 's'}
        {analysis.model ? ` · ${analysis.model}` : ''} — a reading aid, not a verdict.
      </p>
      <h4>Summary</h4>
      <p>{analysis.summary}</p>
      <h4>What went well</h4>{list(analysis.went_well)}
      <h4>Common positive themes</h4>{list(analysis.positive_themes)}
      <h4>What needs improvement</h4>{list(analysis.needs_improvement)}
      <h4>Common complaints</h4>{list(analysis.complaints)}
      <h4>Recommended actions</h4>
      {analysis.recommended_actions.length === 0
        ? <p className="muted">—</p>
        : <ol>{analysis.recommended_actions.map((x, i) => <li key={i}>{x}</li>)}</ol>}
      <h4>Priority recommendation</h4>
      <p>{analysis.priority}</p>
    </div>
  )
}

function formatAnswer(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}
