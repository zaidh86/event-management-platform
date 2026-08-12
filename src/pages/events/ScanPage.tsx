import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { listActivities, processTransaction, resolveQr } from '../../lib/api'
import { fmtPoints } from '../../lib/format'

// html5-qrcode is heavy — load it only when the scan page is opened
const Scanner = lazy(() =>
  import('../../components/Scanner').then((m) => ({ default: m.Scanner })),
)
import { useEvent } from './EventLayout'
import type { Activity, QrResolution } from '../../lib/types'

// Volunteer / activity admin station: scan a QR (or type the token),
// see who it is, then award or deduct points — optionally tied to an activity.
export function ScanPage() {
  const { event } = useEvent()
  const [scanning, setScanning] = useState(true)
  const [manual, setManual] = useState('')
  const [target, setTarget] = useState<QrResolution | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listActivities(event.id)
      .then((a) => setActivities(a.filter((x) => x.is_active)))
      .catch(() => {})
  }, [event.id])

  async function lookup(token: string) {
    setError(null)
    try {
      const info = await resolveQr(token.trim())
      if (info.event_id !== event.id) {
        setError('That QR code belongs to a different event.')
        return
      }
      setTarget(info)
      setScanning(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve QR code')
    }
  }

  return (
    <div className="page page-narrow">
      <h2>Scan station</h2>
      {!target && (
        <div className="card stack">
          {scanning
            ? (
              <Suspense fallback={<p className="muted">Starting camera…</p>}>
                <Scanner onScan={(token) => void lookup(token)} />
              </Suspense>
            )
            : <button className="btn btn-ghost" onClick={() => setScanning(true)}>Restart camera</button>}
          <form
            className="row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void lookup(manual)
            }}
          >
            <input placeholder="…or type a QR token (p_/t_…)" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button className="btn btn-ghost">Look up</button>
          </form>
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
      {target && (
        <AwardPanel
          target={target}
          activities={activities}
          onDone={() => {
            setTarget(null)
            setScanning(true)
          }}
          onRefresh={(token) => void lookup(token)}
        />
      )}
    </div>
  )
}

function AwardPanel({ target, activities, onDone }: {
  target: QrResolution
  activities: Activity[]
  onDone: () => void
  onRefresh: (token: string) => void
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
        Activity (optional)
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
              onClick={() => {
                setAmount(String(Math.abs(Number(activity.config.entry_fee))))
              }}
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
