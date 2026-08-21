import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, Bot, FileText, Lightbulb, MessageSquareText, Send,
} from 'lucide-react'
import { askEventAssistant, listFeedbackForms, listFeedbackResponses } from '../../lib/api'
import { loadEventAggregates } from '../../lib/aggregates'
import {
  answerFromData, buildInsights, buildRecommendations, summarizeResponses,
  type EventAggregates, type QuestionSummary,
} from '../../lib/insights'
import { FeedbackManager } from './FeedbackPage'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatTile } from '../../components/ui/StatTile'
import { useEvent } from './EventLayout'
import type { FeedbackForm } from '../../lib/types'

// Event analytics (ADR-0012): every figure is computed from rows the manager
// can already read under RLS. Insights/recommendations are the deterministic
// rule engine — labeled as computed, never presented as AI. The assistant
// panel uses the LLM Edge Function when deployed, otherwise data lookup.
export function AnalyticsPage() {
  const { event, canManageEvent } = useEvent()
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

          <AssistantPanel agg={agg} />
        </>
      )}
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
