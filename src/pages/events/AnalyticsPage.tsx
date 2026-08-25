import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, Bot, FileText, Lightbulb, MessageSquareText, Paperclip, Send, Sparkles,
} from 'lucide-react'
import {
  analyzeEventReport, askEventAssistant, createReportCriterion, deleteReportCriterion,
  listFeedbackForms, listFeedbackResponses, listReportCriteria, removeEventReport,
  updateReportCriterion, uploadEventReport,
} from '../../lib/api'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { useToast } from '../../components/ui/Toast'
import { loadEventAggregates } from '../../lib/aggregates'
import {
  answerFromData, buildInsights, buildRecommendations, summarizeResponses,
  type EventAggregates, type QuestionSummary,
} from '../../lib/insights'
import { FeedbackManager } from './FeedbackPage'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatTile } from '../../components/ui/StatTile'
import { useEvent } from './EventLayout'
import type { EventReportAnalysis, EventReportAnalysisCriterion, FeedbackForm } from '../../lib/types'

// Event analytics (ADR-0012): every figure is computed from rows the manager
// can already read under RLS. Insights/recommendations are the deterministic
// rule engine — labeled as computed, never presented as AI. The assistant
// panel uses the LLM Edge Function when deployed, otherwise data lookup.
export function AnalyticsPage() {
  const { event, canManageEvent, isClubAdmin } = useEvent()
  const [agg, setAgg] = useState<EventAggregates | null>(null)
  const [formSummaries, setFormSummaries] = useState<{ form: FeedbackForm; qs: QuestionSummary[] }[]>([])

  useEffect(() => {
    if (!canManageEvent) return
    let alive = true
    async function load() {
      const snapshot = await loadEventAggregates(event)
      if (!alive) return
      setAgg(snapshot)
      if (event.capabilities.feedback) {
        const forms = await listFeedbackForms(event.id).catch(() => [])
        const sums = await Promise.all(
          forms.filter((f) => f.status !== 'draft').map(async (f) => {
            const responses = await listFeedbackResponses(f.id).catch(() => [])
            return { form: f, qs: summarizeResponses(f, responses) }
          }),
        )
        if (alive) setFormSummaries(sums.filter((x) => x.qs.some((q) => q.answered > 0)))
      }
    }
    void load()
    return () => { alive = false }
  }, [event, canManageEvent])

  const insights = useMemo(() => (agg ? buildInsights(agg) : []), [agg])
  const recommendations = useMemo(() => (agg ? buildRecommendations(agg) : []), [agg])

  if (!canManageEvent) {
    return (
      <div className="page">
        <p className="form-error">Only Event Managers can view analytics.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Analytics</h2>
        <Link to={`/events/${event.id}/report`} className="btn btn-ghost btn-sm">
          <FileText size={14} aria-hidden /> Event report
        </Link>
      </div>

      {!agg ? <Skeleton lines={4} height="3rem" /> : (
        <>
          <div className="stat-grid">
            <div className="card"><StatTile label="Registrations" icon={BarChart3}>{agg.participantCount}</StatTile></div>
            {agg.event.capabilities.teams && (
              <div className="card"><StatTile label="Teams" icon={BarChart3}>{agg.teamCount}</StatTile></div>
            )}
            {agg.attendanceCount !== null && (
              <div className="card">
                <StatTile label="Checked in" icon={BarChart3}>
                  {agg.attendanceCount}
                  <span className="muted stat-sub">
                    {agg.participantCount > 0 ? ` ${Math.round((agg.attendanceCount / agg.participantCount) * 100)}%` : ''}
                  </span>
                </StatTile>
              </div>
            )}
            {agg.scans !== null && (
              <div className="card"><StatTile label="QR scans" icon={BarChart3}>{agg.scans.length}</StatTile></div>
            )}
            {agg.transactions !== null && (
              <div className="card"><StatTile label="Transactions" icon={BarChart3}>{agg.transactions.length}</StatTile></div>
            )}
            {agg.submissions !== null && (
              <div className="card">
                <StatTile label="Submissions" icon={BarChart3}>
                  {agg.submissions.filter((s) => s.status === 'submitted').length}
                </StatTile>
              </div>
            )}
            {agg.feedbackForms !== null && (
              <div className="card">
                <StatTile label="Feedback responses" icon={BarChart3}>
                  {agg.feedbackForms.reduce((n, f) => n + f.responseCount, 0)}
                </StatTile>
              </div>
            )}
          </div>

          <section className="card stack">
            <h3><Lightbulb size={16} aria-hidden /> Insights</h3>
            <p className="muted">Computed from this event's data — no AI involved.</p>
            {insights.length === 0 && <p className="muted">Not enough data yet.</p>}
            <ul className="insight-list">
              {insights.map((i, idx) => (
                <li key={idx} className={i.kind === 'gap' ? 'insight-gap' : ''}>{i.text}</li>
              ))}
            </ul>
          </section>

          {recommendations.length > 0 && (
            <section className="card stack">
              <h3>Recommendations</h3>
              <p className="muted">Data-backed suggestions — judgement stays with you.</p>
              <ul className="insight-list">
                {recommendations.map((r, idx) => <li key={idx}>{r}</li>)}
              </ul>
            </section>
          )}

          {formSummaries.length > 0 && (
            <section className="card stack">
              <h3><MessageSquareText size={16} aria-hidden /> Feedback &amp; event reports</h3>
              {formSummaries.map(({ form, qs }) => (
                <div key={form.id} className="stack form-summary">
                  <h4>{form.kind === 'reflection' ? 'Event report' : 'Feedback'}: {form.title}</h4>
                  <ul className="insight-list">
                    {qs.map((q) => (
                      <li key={q.label}>
                        <strong>{q.label}</strong> — {q.answered} answered
                        {q.average !== undefined && ` · average ${q.average}/${q.max}`}
                        {q.distribution && q.distribution.length > 0 && (
                          <> · {q.distribution.map((d) => `${d.option}: ${d.count}`).join(', ')}</>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {event.capabilities.feedback && (
            <section className="card">
              <FeedbackManager kind="reflection" />
            </section>
          )}

          {isClubAdmin && <EventReportAnalysisSection eventId={event.id} />}

          <AssistantPanel agg={agg} />
        </>
      )}
    </div>
  )
}

// Event Report AI Analysis (00025). Visible ONLY to club authority
// (super_admin / club_admin / convener — the isClubAdmin context flag mirrors
// is_club_admin()); the criteria table RLS, the storage policies and the
// ai-service all re-check the same authority server-side, so hiding the
// section is presentation, not security.
//
// The criteria here are event_report_analysis_criteria — this feature's OWN
// system, completely separate from judging_criteria. Nothing here reads or
// writes judging configuration or official judging scores.
function EventReportAnalysisSection({ eventId }: { eventId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [uploaded, setUploaded] = useState<{ path: string; name: string } | null>(null)
  const [analysis, setAnalysis] = useState<EventReportAnalysis | null>(null)
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'analyzing'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function analyze() {
    if (busy !== 'idle') return
    setError(null)
    setAnalysis(null)
    try {
      let doc = uploaded
      if (file) {
        setBusy('uploading')
        // replacing the selection replaces the stored document too
        if (doc) await removeEventReport(doc.path).catch(() => {})
        doc = await uploadEventReport(eventId, file)
        setUploaded(doc)
        setFile(null)
      }
      if (!doc) {
        setError('Attach the event report PDF first.')
        return
      }
      setBusy('analyzing')
      setAnalysis(await analyzeEventReport(eventId, doc.path))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI analysis is temporarily unavailable — try again.')
    } finally {
      setBusy('idle')
    }
  }

  async function removeDoc() {
    setError(null)
    if (uploaded) await removeEventReport(uploaded.path).catch(() => {})
    setUploaded(null)
    setFile(null)
    setAnalysis(null)
  }

  const selectedName = file?.name ?? uploaded?.name ?? null

  return (
    <section className="card stack">
      <h3><Sparkles size={16} aria-hidden /> Event Report AI Analysis</h3>
      <p className="muted">
        Attach the event report (PDF, up to 10 MB) and the AI reviews it against
        the analysis criteria configured below — a criterion system of its own,
        independent of the judging criteria. Advisory only: nothing here reads
        or changes any judging score.
      </p>

      <ReportCriteriaManager eventId={eventId} />

      <div className="doc-row">
        <label className="btn btn-ghost btn-sm file-btn">
          <Paperclip size={14} aria-hidden /> {selectedName ? 'Replace document' : 'Attach event report (PDF)'}
          <input
            type="file" accept="application/pdf,.pdf" hidden
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }}
          />
        </label>
        {selectedName && (
          <>
            <span className="doc-name"><FileText size={14} aria-hidden /> {selectedName}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== 'idle'} onClick={() => void removeDoc()}>
              Remove
            </button>
          </>
        )}
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={busy !== 'idle' || (!file && !uploaded)}
          onClick={() => void analyze()}
        >
          {busy === 'uploading' ? 'Uploading…' : busy === 'analyzing' ? 'Analyzing…' : analysis ? 'Re-analyze' : 'Analyze event report'}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {analysis && (
        <div className="stack">
          <p className="muted">
            AI analysis{analysis.model ? ` · ${analysis.model}` : ''} — suggestions for review, not results.
          </p>
          <div className="ai-analysis">
            <h4>Summary</h4>
            <p>{analysis.summary}</p>
            {analysis.strengths.length > 0 && (
              <><h4>Strengths</h4><ul>{analysis.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></>
            )}
            {analysis.weaknesses.length > 0 && (
              <><h4>Weaknesses</h4><ul>{analysis.weaknesses.map((x, i) => <li key={i}>{x}</li>)}</ul></>
            )}
          </div>
          {analysis.criteria.map((c) => (
            <div className="eval-criterion-card" key={c.criterion_id}>
              <strong>{c.criterion}</strong>
              {c.suggested_score !== undefined ? (
                <div className="ai-suggestion">
                  <strong>AI Score: {c.suggested_score}/{c.max_score}</strong>
                  {c.reasoning && <span>{c.reasoning}</span>}
                  {(c.evidence?.length ?? 0) > 0 && (
                    <ul>{c.evidence!.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  )}
                </div>
              ) : (
                <p className="muted">The AI did not produce a suggestion for this criterion.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Draft-based editor for the Event Report Analysis criteria — the same stable
// local-drafts + explicit-Save pattern as the judging criteria editor (no
// per-keystroke writes, no reload-over-edits, a fetch error never clears a
// loaded list), but over event_report_analysis_criteria via its own API.
interface ReportCriterionDraft {
  id: string
  name: string
  description: string
  ai_instructions: string
  max_score: string
  weight: string
  is_enabled: boolean
}

function toReportDraft(c: EventReportAnalysisCriterion): ReportCriterionDraft {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    ai_instructions: c.ai_instructions,
    max_score: String(c.max_score),
    weight: String(c.weight),
    is_enabled: c.is_enabled,
  }
}

function reportDraftChanged(d: ReportCriterionDraft, saved: ReportCriterionDraft): boolean {
  return d.name !== saved.name || d.description !== saved.description
    || d.ai_instructions !== saved.ai_instructions
    || d.max_score !== saved.max_score || d.weight !== saved.weight
    || d.is_enabled !== saved.is_enabled
}

function ReportCriteriaManager({ eventId }: { eventId: string }) {
  const toast = useToast()
  const [drafts, setDrafts] = useState<ReportCriterionDraft[] | null>(null)
  const [saved, setSaved] = useState<Map<string, ReportCriterionDraft>>(new Map())
  const [confirmDelete, setConfirmDelete] = useState<ReportCriterionDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    listReportCriteria(eventId)
      .then((cs) => {
        if (cancelled) return
        setDrafts(cs.map(toReportDraft))
        setSaved(new Map(cs.map((c) => [c.id, toReportDraft(c)])))
      })
      .catch(() => {
        if (!cancelled) setDrafts((prev) => prev ?? [])
      })
    return () => { cancelled = true }
  }, [eventId])

  const dirty = (drafts ?? []).some((d) => {
    const base = saved.get(d.id)
    return !base || reportDraftChanged(d, base)
  })

  function edit(id: string, fields: Partial<ReportCriterionDraft>) {
    setDrafts((ds) => ds?.map((d) => (d.id === id ? { ...d, ...fields } : d)) ?? null)
  }

  async function saveAll() {
    if (!drafts || busy) return
    setError(null)
    const names = new Set<string>()
    for (const d of drafts) {
      const name = d.name.trim()
      if (name === '') { setError('Every criterion needs a name.'); return }
      if (names.has(name.toLowerCase())) {
        setError(`Two criteria are both named "${name}" — names must be unique.`)
        return
      }
      names.add(name.toLowerCase())
      const max = Number(d.max_score)
      if (!Number.isFinite(max) || max <= 0) { setError(`"${name}": maximum score must be a number greater than 0.`); return }
      const weight = Number(d.weight)
      if (!Number.isFinite(weight) || weight < 0) { setError(`"${name}": weight must be 0 or more.`); return }
    }
    const changed = drafts.filter((d) => {
      const base = saved.get(d.id)
      return !base || reportDraftChanged(d, base)
    })
    if (changed.length === 0) return
    setBusy(true)
    try {
      const results = new Map(saved)
      for (const d of changed) {
        const updated = await updateReportCriterion(d.id, {
          name: d.name.trim(),
          description: d.description,
          ai_instructions: d.ai_instructions,
          max_score: Number(d.max_score),
          weight: Number(d.weight),
          is_enabled: d.is_enabled,
        })
        results.set(d.id, toReportDraft(updated))
      }
      setSaved(results)
      setDrafts((ds) => ds?.map((d) => results.get(d.id) ?? d) ?? null)
      toast('success', `${changed.length} analysis criteri${changed.length === 1 ? 'on' : 'a'} saved`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed — your edits are still here, try again.')
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!drafts) return
    setBusy(true)
    setError(null)
    try {
      const row = await createReportCriterion({
        event_id: eventId,
        name: `Analysis criterion ${drafts.length + 1}`,
        sort_order: drafts.length,
      })
      const d = toReportDraft(row)
      setDrafts((ds) => [...(ds ?? []), d])
      setSaved((m) => new Map(m).set(d.id, d))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await deleteReportCriterion(confirmDelete.id)
      toast('success', `"${confirmDelete.name}" removed`)
      setDrafts((ds) => ds?.filter((d) => d.id !== confirmDelete.id) ?? null)
      setSaved((m) => { const n = new Map(m); n.delete(confirmDelete.id); return n })
      setConfirmDelete(null)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Delete failed')
      setConfirmDelete(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h4>Analysis criteria</h4>
      <p className="muted">
        What the AI should assess in the event report. These are separate from
        the judging criteria and never affect judging.
      </p>
      {drafts === null && <Skeleton lines={2} height="2.2rem" />}
      {drafts !== null && drafts.length === 0 && (
        <p className="muted">No analysis criteria yet — add the first one.</p>
      )}
      {drafts?.map((c) => (
        <div className="criterion-card card" key={c.id}>
          <div className="criterion-line">
            <label>
              Criterion
              <input value={c.name} maxLength={80} onChange={(e) => edit(c.id, { name: e.target.value })} />
            </label>
            <label className="crit-num">
              Max score
              <input
                type="number" min={1} step="any" value={c.max_score}
                onChange={(e) => edit(c.id, { max_score: e.target.value })}
              />
            </label>
            <label className="crit-num">
              Weight
              <input
                type="number" min={0} step="any" value={c.weight}
                onChange={(e) => edit(c.id, { weight: e.target.value })}
              />
            </label>
          </div>
          <label>
            Guidance <span className="field-hint">what does this criterion mean?</span>
            <textarea
              rows={2} value={c.description} maxLength={1000}
              onChange={(e) => edit(c.id, { description: e.target.value })}
            />
          </label>
          <label>
            AI instructions <span className="field-hint">what should the AI look for in the report? (optional — falls back to the guidance)</span>
            <textarea
              rows={2} value={c.ai_instructions} maxLength={2000}
              onChange={(e) => edit(c.id, { ai_instructions: e.target.value })}
            />
          </label>
          <div className="criterion-line">
            <label className="check">
              <input type="checkbox" checked={c.is_enabled} onChange={(e) => edit(c.id, { is_enabled: e.target.checked })} />
              Enabled
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(c)}>Remove</button>
          </div>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || drafts === null} onClick={() => void add()}>
          + Add analysis criterion
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void saveAll()}>
          {busy ? 'Saving…' : 'Save analysis criteria'}
        </button>
        {dirty && !busy && <span className="muted">Unsaved changes</span>}
      </div>
      {error && <p className="form-error">{error}</p>}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Remove analysis criterion "${confirmDelete?.name ?? ''}"?`}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      >
        <p className="muted">This only affects Event Report Analysis — judging criteria are untouched.</p>
      </ConfirmDialog>
    </div>
  )
}

// Ask about the event. LLM path = the event-assistant Edge Function (ADR-0012);
// until it is deployed, answers come from the loaded aggregates and say so.
function AssistantPanel({ agg }: { agg: EventAggregates }) {
  const [question, setQuestion] = useState('')
  const [thread, setThread] = useState<{ q: string; a: string; source: 'ai' | 'data' }[]>([])
  const [busy, setBusy] = useState(false)

  async function ask(q: string) {
    if (!q.trim() || busy) return
    setBusy(true)
    try {
      const answer = await askEventAssistant(agg.event.id, q)
      setThread((t) => [...t, { q, a: answer, source: 'ai' }])
    } catch {
      setThread((t) => [...t, { q, a: answerFromData(q, agg), source: 'data' }])
    } finally {
      setBusy(false)
      setQuestion('')
    }
  }

  const chips = ['How many registered?', 'Attendance so far?', 'Who is leading?', 'Feedback summary?']

  return (
    <section className="card stack">
      <h3><Bot size={16} aria-hidden /> Ask about this event</h3>
      <p className="muted">
        Answers marked <span className="badge">data</span> are direct lookups from
        this event's records. AI answers require the event-assistant function to
        be deployed (see docs) and are marked <span className="badge">AI</span>.
      </p>
      <div className="row">
        {chips.map((c) => (
          <button key={c} type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void ask(c)}>
            {c}
          </button>
        ))}
      </div>
      {thread.map((t, i) => (
        <div key={i} className="assistant-turn">
          <p className="assistant-q">{t.q}</p>
          <p className="assistant-a">
            <span className="badge">{t.source === 'ai' ? 'AI' : 'data'}</span> {t.a}
          </p>
        </div>
      ))}
      <form
        className="assistant-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void ask(question)
        }}
      >
        <input
          placeholder="Ask about registrations, attendance, results…"
          value={question} onChange={(e) => setQuestion(e.target.value)}
          aria-label="Question about this event"
        />
        <button className="btn btn-primary" disabled={busy}>
          <Send size={16} aria-hidden /> Send
        </button>
      </form>
    </section>
  )
}
