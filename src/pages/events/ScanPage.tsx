import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  countAttendance, listActivities, listCriteria, listMyEvaluations, performScan,
  processTransaction, resolveQr,
} from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { fmtDateTime, fmtPoints } from '../../lib/format'
import { ACTION_LABELS, stationConfigs } from '../../lib/qr'
import { listQrConfigs } from '../../lib/api'
import { EvaluationEditor } from './JudgingPage'
import type {
  Activity, JudgeEvaluation, JudgingCriterion, QrAction, QrConfig, QrResolution,
  ScanOutcome, Submission,
} from '../../lib/types'

// html5-qrcode is heavy — load it only when the scan page is opened
const Scanner = lazy(() =>
  import('../../components/Scanner').then((m) => ({ default: m.Scanner })),
)
import { useEvent } from './EventLayout'

// Universal scan station (ADR-0009). Staff pick the QR OPERATION the station is
// running (from the event's configured QR operations), scan, and the server
// validates everything: config, event, action, authorization, target, duplicate
// rules. With no configured operations the station falls back to the legacy
// scoring flow (resolve_qr), so pre-00014 events behave exactly as before.

const LEGACY_ID = '__legacy_scoring__'

export function ScanPage() {
  const { event, isStaff, role } = useEvent()
  const isJudge = role === 'judge'
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<QrConfig[] | null>(null)
  const [opId, setOpId] = useState<string>('')
  const [action, setAction] = useState<QrAction | ''>('')
  const [manual, setManual] = useState('')
  const [activities, setActivities] = useState<Activity[]>([])
  const [scoringTarget, setScoringTarget] = useState<QrResolution | null>(null)
  const [judgeTarget, setJudgeTarget] = useState<{ teamId: string | null; participantId: string | null; name: string } | null>(null)
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attended, setAttended] = useState<number | null>(null)

  useEffect(() => {
    listActivities(event.id)
      .then((a) => setActivities(a.filter((x) => x.is_active)))
      .catch(() => {})
    listQrConfigs(event.id)
      .then((all) => {
        // judges (existing event role, 00016) see only the operations that
        // authorize them; staff see every station operation
        const ops = stationConfigs(all).filter(
          (c) => isStaff || c.scanner_access.includes('judge'),
        )
        setConfigs(ops)
        setOpId(ops.length > 0 ? ops[0].id : isStaff && event.capabilities.points ? LEGACY_ID : '')
        setAction(ops.length > 0 ? ops[0].actions[0] : 'scoring')
      })
      .catch(() => {
        setConfigs([])
        setOpId(isStaff && event.capabilities.points ? LEGACY_ID : '')
        setAction('scoring')
      })
  }, [event.id, event.capabilities.points, isStaff])

  const current = (configs ?? []).find((c) => c.id === opId) ?? null
  const isAttendanceOp = current !== null && action === 'attendance'

  useEffect(() => {
    if (isAttendanceOp) {
      countAttendance(event.id).then(setAttended).catch(() => {})
    }
  }, [isAttendanceOp, event.id, outcome])

  function selectOp(id: string) {
    setOpId(id)
    setError(null)
    setOutcome(null)
    setScoringTarget(null)
    const cfg = (configs ?? []).find((c) => c.id === id)
    setAction(cfg ? cfg.actions[0] : 'scoring')
  }

  async function handleToken(token: string) {
    const t = token.trim()
    if (!t || busy) return
    setBusy(true)
    setError(null)
    setOutcome(null)
    try {
      if (!current) {
        // legacy scoring flow: resolve, then award via the existing panel
        const info = await resolveQr(t)
        if (info.event_id !== event.id) {
          setError('That QR code belongs to a different event.')
          return
        }
        setScoringTarget(info)
        return
      }
      const result = await performScan(current.id, t, action as QrAction)
      if (result.action === 'feedback' && result.status === 'ok' && result.form_id) {
        // open the configured form pre-bound to the scanned target; the server
        // enforces per-target dedupe on submission (00019)
        const ti = result.team_id ?? result.participant_id ?? ''
        navigate(`/f/${result.form_id}?tt=${result.kind ?? 'team'}&ti=${ti}&tn=${encodeURIComponent(result.name)}`)
        return
      }
      if (result.action === 'scoring' && result.status === 'ok'
          && ((isJudge && !isStaff) || (!event.capabilities.points && event.capabilities.judging))) {
        // judges evaluate against the judging criteria (00016) — never the
        // points ledger; staff land here too when the event has judging but
        // no points ledger (nothing to award). Opens the team/participant's
        // submission evaluation in the EXISTING judging editor.
        setJudgeTarget({
          teamId: result.team_id ?? null,
          participantId: result.kind === 'participant' ? result.participant_id ?? null : null,
          name: result.name,
        })
        return
      }
      if (result.action === 'scoring' && result.status === 'ok') {
        setScoringTarget({
          kind: result.kind ?? 'participant',
          event_id: event.id,
          participant_id: result.participant_id,
          participant_name: result.participant_name,
          team_id: result.team_id,
          name: result.name,
          account_id: result.account_id ?? '',
          balance: result.balance ?? 0,
        })
        return
      }
      setOutcome(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setBusy(false)
      setManual('')
    }
  }

  // staff and judges may scan; perform_scan re-authorizes per configuration.
  // (Self-service participant scanning is authorized server-side when a
  // configuration allows it — a participant-facing scan surface is future UI
  // work, not a security gap.)
  if (!isStaff && !isJudge) {
    return (
      <div className="page">
        <p className="form-error">Only event staff and judges can run a scan station.</p>
      </div>
    )
  }

  const noOperations = configs !== null && configs.length === 0
    && (!isStaff || !event.capabilities.points)

  return (
    <div className="page page-narrow">
      <h2>Scan station</h2>

      {configs !== null && (configs.length > 0 || (isStaff && event.capabilities.points)) && (
        <div className="card stack">
          <label>
            QR operation
            <select value={opId} onChange={(e) => selectOp(e.target.value)}>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
              {isStaff && event.capabilities.points && (
                <option value={LEGACY_ID}>Scoring station{configs.length > 0 ? ' (general)' : ''}</option>
              )}
            </select>
          </label>
          {current && (
            <>
              {current.description && <p className="muted">{current.description}</p>}
              {current.actions.length > 1 && (
                <label>
                  Action
                  <select value={action} onChange={(e) => setAction(e.target.value as QrAction)}>
                    {current.actions.map((a) => (
                      <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                    ))}
                  </select>
                </label>
              )}
              {current.actions.length === 1 && (
                <p className="muted">Action: {ACTION_LABELS[current.actions[0]]}</p>
              )}
            </>
          )}
          {isAttendanceOp && attended !== null && (
            <p className="muted">{attended} checked in so far.</p>
          )}
        </div>
      )}

      {noOperations && (
        <div className="card">
          <p className="muted">
            {isStaff
              ? 'No QR operations are configured for this event yet. An Event Manager can add them in Event settings → QR operations.'
              : 'No QR operations are configured for judges yet. Ask the Event Manager to grant Judges access to a QR operation.'}
          </p>
        </div>
      )}

      {!scoringTarget && !judgeTarget && !noOperations && (
        <div className="card stack">
          <Suspense fallback={<p className="muted">Loading scanner…</p>}>
            <Scanner onScan={(token) => void handleToken(token)} />
          </Suspense>
          <form
            className="row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void handleToken(manual)
            }}
          >
            <input
              placeholder="…or enter a code manually"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button className="btn btn-ghost" disabled={busy}>Look up</button>
          </form>

          {outcome && <ScanResult outcome={outcome} onNext={() => setOutcome(null)} />}
          {error && (
            <div className="scan-flash scan-flash-error" role="alert">
              <AlertTriangle size={18} aria-hidden />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {scoringTarget && (
        <AwardPanel
          target={scoringTarget}
          activities={activities}
          onDone={() => {
            setScoringTarget(null)
            setOutcome(null)
          }}
        />
      )}

      {judgeTarget && (
        <JudgeEvalPanel
          eventId={event.id}
          target={judgeTarget}
          onDone={() => setJudgeTarget(null)}
        />
      )}
    </div>
  )
}

// Judge scanned a team/participant QR with the scoring action: resolve their
// SUBMITTED entry and open the standard evaluation editor (criteria +
// notes + finalize — save_evaluation authorizes and validates server-side).
function JudgeEvalPanel({ eventId, target, onDone }: {
  eventId: string
  target: { teamId: string | null; participantId: string | null; name: string }
  onDone: () => void
}) {
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [criteria, setCriteria] = useState<JudgingCriterion[]>([])
  const [existing, setExisting] = useState<JudgeEvaluation | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      let q = supabase.from('submissions').select('*').eq('event_id', eventId).eq('status', 'submitted')
      q = target.teamId ? q.eq('team_id', target.teamId) : q.eq('participant_id', target.participantId ?? '')
      const [{ data: sub }, cs, mine] = await Promise.all([
        q.maybeSingle(),
        listCriteria(eventId).catch(() => [] as JudgingCriterion[]),
        listMyEvaluations(eventId).catch(() => [] as JudgeEvaluation[]),
      ])
      if (!alive) return
      const found = (sub ?? null) as Submission | null
      setSubmission(found)
      setCriteria(cs.filter((c) => c.is_enabled))
      setExisting(found ? mine.find((e) => e.submission_id === found.id) ?? null : null)
      setLoaded(true)
    }
    void load()
    return () => { alive = false }
  }, [eventId, target])

  return (
    <div className="card stack">
      <div className="scan-target">
        <div>
          <h3>{target.name}</h3>
          <p className="muted">{target.teamId ? 'Team' : 'Participant'} · judging</p>
        </div>
      </div>
      {!loaded && <p className="muted">Loading entry…</p>}
      {loaded && !submission && (
        <p className="muted">
          No submitted entry for {target.name} yet — evaluations open once they
          hand in their submission.
        </p>
      )}
      {loaded && submission && (
        <EvaluationEditor
          submissionId={submission.id}
          criteria={criteria}
          existing={existing}
          onSaved={onDone}
        />
      )}
      <button className="btn btn-ghost" onClick={onDone}>Scan next</button>
    </div>
  )
}

// clear, human outcome states: what was scanned, what happened, duplicate info
function ScanResult({ outcome, onNext }: { outcome: ScanOutcome; onNext: () => void }) {
  if (outcome.status === 'duplicate') {
    return (
      <div className="scan-flash scan-flash-warn" role="status">
        <AlertTriangle size={18} aria-hidden />
        <span>
          <strong>Already checked in</strong> — {outcome.name} was marked present
          {outcome.recorded_at ? ` at ${fmtDateTime(outcome.recorded_at)}` : ''}.
        </span>
      </div>
    )
  }
  return (
    <div className="scan-flash scan-flash-ok" role="status">
      <CheckCircle2 size={18} aria-hidden />
      <span>
        {outcome.action === 'attendance' && <><strong>Attendance recorded</strong> — {outcome.name}</>}
        {outcome.action === 'verification' && (
          <><strong>{outcome.kind === 'team' ? 'Team verified' : 'Verified'}</strong> — {outcome.name}</>
        )}
        {outcome.action !== 'attendance' && outcome.action !== 'verification' && (
          <><strong>Done</strong> — {outcome.name}</>
        )}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onNext}>Scan next</button>
    </div>
  )
}

function AwardPanel({ target, activities, onDone }: {
  target: QrResolution
  activities: Activity[]
  onDone: () => void
}) {
  const { event } = useEvent()
  const [amount, setAmount] = useState('')
  const [activityId, setActivityId] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [balance, setBalance] = useState(target.balance)

  const activity = activities.find((a) => a.id === activityId)

  async function submit(sign: 1 | -1, type: 'award' | 'deduct' | 'entry_fee') {
    const n = Math.abs(Number(amount))
    if (!n || !Number.isFinite(n)) {
      setError('Enter a valid amount')
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const tx = await processTransaction({
        accountId: target.account_id,
        amount: sign * n,
        type,
        activityId: activityId || null,
        description: description || (activity ? activity.name : ''),
      })
      setBalance((b) => Number(b) + Number(tx.amount))
      setSuccess(`Recorded ${fmtPoints(event, tx.amount)} for ${target.name}`)
      setAmount('')
      setDescription('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card stack scan-result">
      <div className="scan-target">
        <div>
          <h3>{target.name}</h3>
          <p className="muted">
            {target.kind === 'team' ? 'Team' : 'Participant'}
            {target.participant_name && target.kind === 'team' && ` · scanned: ${target.participant_name}`}
          </p>
        </div>
        <div className="balance-big">
          <img src={event.currency_image_url ?? '/currency-default.svg'} alt="" className="currency-img" />
          {fmtPoints(event, balance)}
        </div>
      </div>

      <label>
        Task (optional)
        <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
          <option value="">— none —</option>
          {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {activity && (
        <p className="muted activity-hints">
          {activity.config.entry_fee != null && <>Entry fee: {fmtPoints(event, Number(activity.config.entry_fee))} · </>}
          {activity.config.reward != null && <>Reward: {fmtPoints(event, Number(activity.config.reward))} · </>}
          {activity.config.deduction != null && <>Deduction: {fmtPoints(event, Number(activity.config.deduction))} · </>}
          {activity.config.time_limit_seconds != null && <>Time limit: {Number(activity.config.time_limit_seconds)}s</>}
        </p>
      )}
      <div className="row">
        <label>
          Amount
          <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Note
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
        </label>
      </div>
      <div className="row scan-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit(1, 'award')}>Award</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => void submit(-1, 'deduct')}>Deduct</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void submit(-1, 'entry_fee')}>Charge entry fee</button>
      </div>
      {activity && (
        <div className="row">
          {activity.config.entry_fee != null && Number(activity.config.entry_fee) > 0 && (
            <button
              className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => setAmount(String(Math.abs(Number(activity.config.entry_fee))))}
            >
              Use entry fee amount
            </button>
          )}
          {activity.config.reward != null && (
            <button
              className="btn btn-ghost btn-sm" disabled={busy}
              onClick={() => setAmount(String(Math.abs(Number(activity.config.reward))))}
            >
              Use reward amount
            </button>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-notice">{success}</p>}
      <button className="btn btn-ghost" onClick={onDone}>Scan next</button>
    </div>
  )
}
