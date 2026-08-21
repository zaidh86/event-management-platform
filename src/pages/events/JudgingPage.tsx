import { Fragment, useCallback, useEffect, useState } from 'react'
import { Gavel, ListChecks, Plus } from 'lucide-react'
import {
  createCriterion, deleteCriterion, getJudgingResults, getSubmissionDocumentUrl,
  listCriteria, listMembers, listMyEvaluations, listSubmissionEvaluations,
  listSubmissions, saveEvaluation, updateCriterion,
} from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useEvent } from './EventLayout'
import type {
  JudgeEvaluation, JudgingCriterion, JudgingResult, Submission,
} from '../../lib/types'

// Judging (ADR-0011). Event Managers configure criteria and read results;
// assigned judges work their queue of submitted entries. All authorization is
// server-side (RLS + save_evaluation/get_judging_results) — this page only
// chooses which view to render.
export function JudgingPage() {
  const { event, role, canManageEvent } = useEvent()
  const isJudge = role === 'judge'

  if (!canManageEvent && !isJudge) {
    return (
      <div className="page">
        <p className="form-error">Only Event Managers and assigned judges can open judging.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <h2>Judging</h2>
      {canManageEvent ? <ManagerView eventId={event.id} /> : <JudgeView eventId={event.id} />}
    </div>
  )
}

// ---- judge view: queue + evaluation editor -----------------------------------

function JudgeView({ eventId }: { eventId: string }) {
  const [results, setResults] = useState<JudgingResult[] | null>(null)
  const [criteria, setCriteria] = useState<JudgingCriterion[]>([])
  const [mine, setMine] = useState<JudgeEvaluation[]>([])
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(() => {
    getJudgingResults(eventId).then(setResults).catch(() => setResults([]))
    listCriteria(eventId).then((cs) => setCriteria(cs.filter((c) => c.is_enabled))).catch(() => {})
    listMyEvaluations(eventId).then(setMine).catch(() => {})
  }, [eventId])
  useEffect(() => { reload() }, [reload])

  if (results === null) return <Skeleton lines={4} height="2.6rem" />
  if (results.length === 0) {
    return (
      <EmptyState
        icon={Gavel}
        title="Nothing to judge yet"
        hint="Submitted entries appear here once participants hand them in."
      />
    )
  }

  const mineBySubmission = new Map(mine.map((e) => [e.submission_id, e]))

  return (
    <div className="stack">
      <p className="muted">
        {results.length} submitted entr{results.length === 1 ? 'y' : 'ies'} ·
        your evaluations are independent — other judges never see your scores or notes.
      </p>
      {results.map((r) => {
        const myEval = mineBySubmission.get(r.submission_id)
        return (
          <div key={r.submission_id} className="card stack">
            <div className="judge-queue-row">
              <div>
                <h3>{r.title}</h3>
                <p className="muted">
                  {r.owner_type === 'team' ? 'Team' : 'Participant'}: {r.owner_name}
                  {myEval && (
                    <span className={`badge ${myEval.status === 'final' ? 'badge-active' : 'badge-draft'}`}>
                      {myEval.status === 'final' ? 'Finalized' : 'Draft saved'}
                    </span>
                  )}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setOpenId(openId === r.submission_id ? null : r.submission_id)}
              >
                {openId === r.submission_id ? 'Close' : myEval ? 'Edit evaluation' : 'Evaluate'}
              </button>
            </div>
            {openId === r.submission_id && (
              <EvaluationEditor
                submissionId={r.submission_id}
                criteria={criteria}
                existing={myEval ?? null}
                onSaved={reload}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function EvaluationEditor({ submissionId, criteria, existing, onSaved }: {
  submissionId: string
  criteria: JudgingCriterion[]
  existing: JudgeEvaluation | null
  onSaved: () => void
}) {
  const toast = useToast()
  const [detail, setDetail] = useState<Submission | null>(null)
  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(existing?.scores ?? {}).map(([k, v]) => [k, String(v)])),
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // the submission row itself (RLS admits judges for submitted entries)
    supabase.from('submissions').select('*').eq('id', submissionId).maybeSingle()
      .then(({ data }) => setDetail(data as Submission | null))
  }, [submissionId])

  async function save(finalize: boolean) {
    setBusy(true)
    setError(null)
    try {
      const numeric: Record<string, number> = {}
      for (const [k, v] of Object.entries(scores)) {
        if (v.trim() !== '') numeric[k] = Number(v)
      }
      await saveEvaluation({ submissionId, scores: numeric, notes, finalize })
      toast('success', finalize ? 'Evaluation finalized' : 'Draft saved')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack eval-editor">
      {detail && (
        <div className="eval-submission">
          {detail.description && <p>{detail.description}</p>}
          {detail.document_path && (
            <button
              type="button" className="btn btn-ghost btn-sm"
              onClick={() => {
                void getSubmissionDocumentUrl(detail.document_path!)
                  .then((url) => window.open(url, '_blank', 'noreferrer'))
                  .catch(() => {})
              }}
            >
              View submitted PDF — {detail.document_name ?? 'document'} ↗
            </button>
          )}
          {Object.entries(detail.content).length > 0 && (
            <dl className="info-list">
              {Object.entries(detail.content).map(([k, v]) => (
                <div key={k} className="eval-field">
                  <dt>{k.replace(/_/g, ' ')}</dt>
                  <dd className="eval-field-value">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {criteria.length === 0 && (
        <p className="muted">No judging criteria configured yet — ask the Event Manager.</p>
      )}
      {criteria.map((c) => (
        <div className="row eval-criterion" key={c.id}>
          <label>
            {c.name}{c.required && ' *'} <span className="muted">(0–{c.max_score}, weight ×{c.weight})</span>
            <input
              type="number" min={0} max={c.max_score} step="any"
              value={scores[c.id] ?? ''}
              onChange={(e) => setScores((s) => ({ ...s, [c.id]: e.target.value }))}
            />
          </label>
          {c.description && <p className="muted eval-criterion-desc">{c.description}</p>}
        </div>
      ))}
      <label>
        Private notes <span className="muted">(visible to you and Event Managers only)</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button className="btn btn-ghost" disabled={busy} onClick={() => void save(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>
          {existing?.status === 'final' ? 'Update final evaluation' : 'Finalize evaluation'}
        </button>
      </div>
    </div>
  )
}

// ---- manager view: results + criteria ---------------------------------------

function ManagerView({ eventId }: { eventId: string }) {
  const [judgeCount, setJudgeCount] = useState(0)

  useEffect(() => {
    listMembers(eventId)
      .then((ms) => setJudgeCount(ms.filter((m) => m.role === 'judge').length))
      .catch(() => {})
  }, [eventId])

  return (
    <div className="stack">
      <ResultsSection eventId={eventId} judgeCount={judgeCount} />
      <CriteriaSection eventId={eventId} />
      <section className="card stack">
        <h3>Judges</h3>
        <p className="muted">
          {judgeCount === 0
            ? 'No judges assigned yet — add people with the Judge role in Members & roles.'
            : `${judgeCount} judge${judgeCount === 1 ? '' : 's'} assigned. Manage them in Members & roles.`}
        </p>
      </section>
    </div>
  )
}

function ResultsSection({ eventId, judgeCount }: { eventId: string; judgeCount: number }) {
  const { event } = useEvent()
  const [results, setResults] = useState<JudgingResult[] | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [evals, setEvals] = useState<Record<string, JudgeEvaluation[]>>({})

  const reload = useCallback(() => {
    getJudgingResults(eventId).then(setResults).catch(() => setResults([]))
    listSubmissions(eventId).then(setSubmissions).catch(() => {})
  }, [eventId])
  useEffect(() => { reload() }, [reload])

  async function toggleDetail(id: string) {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    if (!evals[id]) {
      try {
        const es = await listSubmissionEvaluations(id)
        setEvals((prev) => ({ ...prev, [id]: es }))
      } catch { /* manager RLS failure surfaces as empty */ }
    }
  }

  const draftCount = submissions.filter((s) => s.status === 'draft').length

  return (
    <section className="card stack">
      <h3>Results</h3>
      <p className="muted">
        Ranked by weighted total (criterion averages across finalized evaluations ×
        weight). Participant visibility: {event.submission_config.results_visibility === 'participants'
          ? 'participants can see aggregate results'
          : 'hidden — managers, judges and staff only'} (configure in Event settings).
        {draftCount > 0 && ` ${draftCount} draft submission${draftCount === 1 ? '' : 's'} not yet handed in.`}
      </p>
      {results === null && <Skeleton lines={3} height="2.4rem" />}
      {results !== null && results.length === 0 && (
        <EmptyState icon={ListChecks} title="No submitted entries yet" />
      )}
      {results !== null && results.length > 0 && (
        <div className="table-scroll">
          <table className="responses-table">
            <thead>
              <tr>
                <th>#</th><th>Entry</th><th>{'Participant / Team'}</th>
                <th>Finalized</th><th>Weighted total</th><th />
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <Fragment key={r.submission_id}>
                  <tr>
                    <td>{i + 1}</td>
                    <td>{r.title}</td>
                    <td>{r.owner_name}</td>
                    <td>
                      {r.finalized_count}/{judgeCount || r.evaluation_count}
                      {judgeCount > 0 && r.finalized_count < judgeCount && (
                        <span className="muted"> (incomplete)</span>
                      )}
                    </td>
                    <td>{Number(r.weighted_total).toFixed(2)}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => void toggleDetail(r.submission_id)}>
                        {openId === r.submission_id ? 'Hide' : 'Detail'}
                      </button>
                    </td>
                  </tr>
                  {openId === r.submission_id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="stack">
                          {Object.entries(r.breakdown).length > 0 && (
                            <ul className="breakdown-list">
                              {Object.entries(r.breakdown).map(([cid, b]) => (
                                <li key={cid}>
                                  <strong>{b.name}</strong>: avg {b.avg_score}/{b.max_score}
                                  {' × '}{b.weight} = {b.weighted}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(evals[r.submission_id] ?? []).map((e) => (
                            <div key={e.id} className="eval-note">
                              <span className={`badge ${e.status === 'final' ? 'badge-active' : 'badge-draft'}`}>
                                {e.source === 'ai' ? 'AI' : 'Judge'} · {e.status}
                              </span>
                              <span className="muted"> {fmtDateTime(e.updated_at)}</span>
                              {e.notes && <p className="muted">{e.notes}</p>}
                            </div>
                          ))}
                          {(evals[r.submission_id] ?? []).length === 0 && (
                            <p className="muted">No evaluations yet.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---- criteria management -----------------------------------------------------

function CriteriaSection({ eventId }: { eventId: string }) {
  const toast = useToast()
  const [criteria, setCriteria] = useState<JudgingCriterion[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<JudgingCriterion | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    listCriteria(eventId).then(setCriteria).catch(() => setCriteria([]))
  }, [eventId])
  useEffect(() => { reload() }, [reload])

  async function patch(c: JudgingCriterion, fields: Partial<JudgingCriterion>) {
    try {
      await updateCriterion(c.id, fields)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function add() {
    setBusy(true)
    try {
      await createCriterion({
        event_id: eventId,
        name: `Criterion ${(criteria?.length ?? 0) + 1}`,
        sort_order: criteria?.length ?? 0,
      })
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await deleteCriterion(confirmDelete.id)
      toast('success', `"${confirmDelete.name}" removed`)
      setConfirmDelete(null)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Delete failed')
      setConfirmDelete(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <h3>Judging criteria</h3>
      <p className="muted">
        Judges score each enabled criterion from 0 to its maximum; weights shape
        the total. Removing a criterion removes it from future totals.
      </p>
      {criteria === null && <Skeleton lines={2} height="2.2rem" />}
      {criteria?.map((c) => (
        <div className="field-row criterion-row" key={c.id}>
          <input
            aria-label="Criterion name" value={c.name}
            onBlur={(e) => { if (e.target.value !== c.name) void patch(c, { name: e.target.value }) }}
            onChange={(e) => setCriteria((cs) => cs?.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x) ?? null)}
          />
          <input
            aria-label="Description" placeholder="Description (shown to judges)" value={c.description}
            onBlur={(e) => { if (e.target.value !== c.description) void patch(c, { description: e.target.value }) }}
            onChange={(e) => setCriteria((cs) => cs?.map((x) => x.id === c.id ? { ...x, description: e.target.value } : x) ?? null)}
          />
          <label className="crit-num">
            Max
            <input
              type="number" min={1} step="any" value={c.max_score}
              onChange={(e) => void patch(c, { max_score: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="crit-num">
            Weight
            <input
              type="number" min={0} step="any" value={c.weight}
              onChange={(e) => void patch(c, { weight: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={c.required} onChange={(e) => void patch(c, { required: e.target.checked })} />
            Required
          </label>
          <label className="check">
            <input type="checkbox" checked={c.is_enabled} onChange={(e) => void patch(c, { is_enabled: e.target.checked })} />
            Enabled
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(c)}>Remove</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void add()}>
        <Plus size={14} aria-hidden /> Add criterion
      </button>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Remove criterion "${confirmDelete?.name ?? ''}"?`}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      >
        <p className="muted">
          Scores already given for it remain stored but stop counting toward
          totals. Disable it instead to keep it visible.
        </p>
      </ConfirmDialog>
    </section>
  )
}
