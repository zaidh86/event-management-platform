import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { loadEventAggregates } from '../../lib/aggregates'
import { getLeaderboard, listFeedbackForms, listFeedbackResponses } from '../../lib/api'
import {
  buildInsights, buildRecommendations, summarizeResponses,
  type EventAggregates, type QuestionSummary,
} from '../../lib/insights'
import { fmtDateTime, fmtPoints } from '../../lib/format'
import { entityLabel, metricLabel, resolveEntity } from '../../lib/leaderboard'
import { Skeleton } from '../../components/ui/Skeleton'
import { useEvent } from './EventLayout'
import type { FeedbackForm, LeaderboardRow } from '../../lib/types'

// Event report (ADR-0012): a print-native snapshot of what the event actually
// recorded. "Download PDF" is the browser print pipeline — the print
// stylesheet hides the app chrome and this page becomes the document.
// Everything shown is manager-scoped data; judge identities/notes and
// participant contact details are never included.
export function ReportPage() {
  const { event, canManageEvent } = useEvent()
  const [agg, setAgg] = useState<EventAggregates | null>(null)
  const [board, setBoard] = useState<LeaderboardRow[]>([])
  const [formSummaries, setFormSummaries] = useState<{ form: FeedbackForm; qs: QuestionSummary[] }[]>([])

  useEffect(() => {
    if (!canManageEvent) return
    let alive = true
    void loadEventAggregates(event).then(async (snapshot) => {
      if (!alive) return
      setAgg(snapshot)
      if (event.capabilities.points && event.leaderboard_config.enabled) {
        getLeaderboard(event.id).then((r) => alive && setBoard(r.slice(0, 10))).catch(() => {})
      }
      if (event.capabilities.feedback) {
        const forms = await listFeedbackForms(event.id).catch(() => [])
        const sums = await Promise.all(
          forms.filter((f) => f.status !== 'draft').map(async (f) => ({
            form: f,
            qs: summarizeResponses(f, await listFeedbackResponses(f.id).catch(() => [])),
          })),
        )
        if (alive) setFormSummaries(sums.filter((x) => x.qs.some((q) => q.answered > 0)))
      }
    })
    return () => { alive = false }
  }, [event, canManageEvent])

  const insights = useMemo(() => (agg ? buildInsights(agg) : []), [agg])
  const recommendations = useMemo(() => (agg ? buildRecommendations(agg) : []), [agg])

  if (!canManageEvent) {
    return (
      <div className="page">
        <p className="form-error">Only Event Managers can generate the event report.</p>
      </div>
    )
  }
  if (!agg) return <div className="page"><Skeleton lines={6} height="2.4rem" /></div>

  const entity = resolveEntity(event.leaderboard_config.entity, event.capabilities)

  return (
    <div className="page report" style={{ ['--theme' as string]: event.theme_color }}>
      <div className="page-head print-hide">
        <h2>Event report</h2>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden /> Download PDF
        </button>
      </div>

      <header className="report-head">
        {event.logo_url && <img src={event.logo_url} alt="" className="event-logo" />}
        <div>
          <h1>{event.name}</h1>
          <p className="muted">
            Event report · generated {fmtDateTime(new Date().toISOString())} · status: {event.status}
          </p>
        </div>
      </header>

      <section className="report-section">
        <h3>Overview</h3>
        {event.description && <p>{event.description}</p>}
        <p className="muted">
          Participation: {event.capabilities.solo && event.capabilities.teams
            ? 'solo and teams'
            : event.capabilities.teams ? 'teams' : 'solo'}
          {event.capabilities.teams && ` (teams of ${event.team_size_min}–${event.team_size_max})`}.
        </p>
      </section>

      <section className="report-section">
        <h3>Registration &amp; participation</h3>
        <ul className="insight-list">
          <li>{agg.participantCount} registered participants ({agg.soloCount} solo, {agg.teamModeCount} team mode)</li>
          {event.capabilities.teams && <li>{agg.teamCount} teams</li>}
          {agg.attendanceCount !== null && (
            <li>
              Attendance: {agg.attendanceCount} checked in
              {agg.participantCount > 0 && ` (${Math.round((agg.attendanceCount / agg.participantCount) * 100)}%)`}
            </li>
          )}
          {agg.scans !== null && <li>{agg.scans.length} QR operations recorded</li>}
        </ul>
      </section>

      {agg.transactions !== null && (
        <section className="report-section">
          <h3>Scoring</h3>
          <ul className="insight-list">
            <li>{agg.transactions.length} ledger transactions · {agg.activityCount} configured tasks</li>
          </ul>
          {board.length > 0 && (
            <table className="responses-table">
              <thead>
                <tr><th>#</th><th>{entityLabel(entity)}</th><th>{metricLabel(event)}</th></tr>
              </thead>
              <tbody>
                {board.map((row) => (
                  <tr key={row.account_id}>
                    <td>{row.rank}</td>
                    <td>{row.name}</td>
                    <td>
                      {event.leaderboard_config.metric === 'tasks'
                        ? row.tasks_completed ?? 0
                        : fmtPoints(event, row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {agg.submissions !== null && (
        <section className="report-section">
          <h3>Submissions &amp; judging</h3>
          <ul className="insight-list">
            <li>
              {agg.submissions.filter((s) => s.status === 'submitted').length} submitted entries
              ({agg.submissions.length - agg.submissions.filter((s) => s.status === 'submitted').length} drafts)
              {agg.judgeCount > 0 && ` · ${agg.judgeCount} judges`}
            </li>
          </ul>
          {agg.judging !== null && agg.judging.length > 0 && (
            <table className="responses-table">
              <thead>
                <tr><th>#</th><th>Entry</th><th>Participant / Team</th><th>Finalized</th><th>Weighted total</th></tr>
              </thead>
              <tbody>
                {agg.judging.map((r, i) => (
                  <tr key={r.submission_id}>
                    <td>{i + 1}</td>
                    <td>{r.title}</td>
                    <td>{r.owner_name}</td>
                    <td>{r.finalized_count}</td>
                    <td>{Number(r.weighted_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {formSummaries.length > 0 && (
        <section className="report-section">
          <h3>Feedback &amp; event reports</h3>
          {formSummaries.map(({ form, qs }) => (
            <div key={form.id}>
              <h4>{form.kind === 'reflection' ? 'Event report' : 'Feedback'}: {form.title}</h4>
              <ul className="insight-list">
                {qs.map((q) => (
                  <li key={q.label}>
                    {q.label} — {q.answered} answered
                    {q.average !== undefined && ` · average ${q.average}/${q.max}`}
                    {q.distribution && ` · ${q.distribution.map((d) => `${d.option}: ${d.count}`).join(', ')}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="report-section">
        <h3>Insights</h3>
        <p className="muted">Computed from event data — not AI interpretation.</p>
        <ul className="insight-list">
          {insights.map((i, idx) => <li key={idx}>{i.text}</li>)}
        </ul>
      </section>

      {recommendations.length > 0 && (
        <section className="report-section">
          <h3>Recommendations</h3>
          <ul className="insight-list">
            {recommendations.map((r, idx) => <li key={idx}>{r}</li>)}
          </ul>
        </section>
      )}

      <footer className="report-foot muted">
        Generated by EMP — Event Management Platform.
      </footer>
    </div>
  )
}
