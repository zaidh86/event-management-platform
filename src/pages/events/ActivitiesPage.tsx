import { useEffect, useState, type FormEvent } from 'react'
import { ListChecks } from 'lucide-react'
import {
  createActivity, deleteActivity, issueActivityApiKey, listActivities, updateActivity,
} from '../../lib/api'
import { fmtPoints } from '../../lib/format'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import { useEvent } from './EventLayout'
import type { Activity, ActivityKind } from '../../lib/types'

// "Tasks" is the universal label for what the schema calls activities: the
// stations, stages, games or checkpoints an event runs (label-only rename —
// the organizer → "Event Manager" precedent).
export function ActivitiesPage() {
  const { event, isOrganizer } = useEvent()
  const toast = useToast()
  const [activities, setActivities] = useState<Activity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [issuedKey, setIssuedKey] = useState<{ name: string; key: string } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [toDelete, setToDelete] = useState<Activity | null>(null)
  const [deleting, setDeleting] = useState(false)

  function load() {
    listActivities(event.id).then(setActivities).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [event.id])

  async function issueKey(a: Activity) {
    try {
      const key = await issueActivityApiKey(a.id)
      setIssuedKey({ name: a.name, key })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue key')
    }
  }

  async function onDelete() {
    if (!toDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await deleteActivity(toDelete.id)
      toast('success', `Deleted "${toDelete.name}"`)
      setToDelete(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task')
      toast('error', 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Tasks</h2>
        {isOrganizer && (
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : 'New task'}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}

      {issuedKey && (
        <div className="card key-reveal">
          <h3>API key for “{issuedKey.name}”</h3>
          <p className="form-error">Copy it now — it is shown only once. Only a hash is stored.</p>
          <code className="api-key">{issuedKey.key}</code>
          <p className="muted">
            The game authenticates with header <code>x-api-key</code> against the
            <code> game-api</code> Edge Function. See <code>docs/GAME_INTEGRATION.md</code>.
          </p>
          <button className="btn btn-ghost btn-sm" onClick={() => setIssuedKey(null)}>Dismiss</button>
        </div>
      )}

      {showForm && isOrganizer && (
        <ActivityForm
          onCreated={(a, key) => {
            setShowForm(false)
            if (key) setIssuedKey({ name: a.name, key })
            load()
          }}
        />
      )}

      {activities.length === 0 && !showForm && (
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          hint={isOrganizer
            ? 'Tasks are the stations, stages or games this event runs. Create the first one.'
            : 'The event team has not set up any tasks yet.'}
        />
      )}
      <div className="activity-grid">
        {activities.map((a) => (
          <div key={a.id} className={`card activity-card ${a.is_active ? '' : 'inactive'}`}>
            <div className="activity-head">
              <h3>{a.name}</h3>
              <span className="badge">{a.kind === 'integrated' ? 'Integrated game' : 'Configured'}</span>
              {!a.is_active && <span className="badge badge-archived">disabled</span>}
            </div>
            {a.description && <p className="muted">{a.description}</p>}
            <ul className="activity-config">
              {a.config.entry_fee != null && <li>Entry fee: {fmtPoints(event, Number(a.config.entry_fee))}</li>}
              {a.config.reward != null && <li>Reward: {fmtPoints(event, Number(a.config.reward))}</li>}
              {a.config.deduction != null && <li>Deduction: {fmtPoints(event, Number(a.config.deduction))}</li>}
              {a.config.time_limit_seconds != null && <li>Time limit: {Number(a.config.time_limit_seconds)}s</li>}
              {a.config.rules ? <li>Rules: {String(a.config.rules)}</li> : null}
            </ul>
            {isOrganizer && (
              <div className="row activity-actions">
                {a.kind === 'integrated' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void issueKey(a)}>
                    {a.api_key_hash ? 'Rotate API key' : 'Issue API key'}
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void updateActivity(a.id, { is_active: !a.is_active }).then(load)
                      .catch((err: Error) => setError(err.message))
                  }}
                >
                  {a.is_active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => setToDelete(a)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete "${toDelete?.name}"?`}
        confirmLabel="Delete task"
        danger
        busy={deleting}
        onConfirm={() => void onDelete()}
        onCancel={() => setToDelete(null)}
      >
        <p className="muted">
          This removes the task permanently. Its past transactions stay in the
          scoring ledger.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function ActivityForm({ onCreated }: { onCreated: (a: Activity, apiKey: string | null) => void }) {
  const { event } = useEvent()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<ActivityKind>('configured')
  const [entryFee, setEntryFee] = useState('')
  const [reward, setReward] = useState('')
  const [deduction, setDeduction] = useState('')
  const [timeLimit, setTimeLimit] = useState('')
  const [rules, setRules] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const config: Record<string, unknown> = {}
      if (entryFee !== '') config.entry_fee = Number(entryFee)
      if (reward !== '') config.reward = Number(reward)
      if (deduction !== '') config.deduction = Number(deduction)
      if (timeLimit !== '') config.time_limit_seconds = Number(timeLimit)
      if (rules.trim() !== '') config.rules = rules.trim()
      const activity = await createActivity({
        event_id: event.id, name, description, kind, config,
      })
      let apiKey: string | null = null
      if (kind === 'integrated') {
        apiKey = await issueActivityApiKey(activity.id)
      }
      onCreated(activity, apiKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="card stack">
      <div className="row">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>
            <option value="configured">Configured (run by event staff in EMP)</option>
            <option value="integrated">Integrated (external game via API)</option>
          </select>
        </label>
      </div>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </label>
      <div className="row">
        <label>
          Entry fee
          <input type="number" step="any" min="0" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="none" />
        </label>
        <label>
          Reward
          <input type="number" step="any" min="0" value={reward} onChange={(e) => setReward(e.target.value)} placeholder="none" />
        </label>
        <label>
          Deduction
          <input type="number" step="any" min="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="none" />
        </label>
        <label>
          Time limit (s)
          <input type="number" min="0" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} placeholder="none" />
        </label>
      </div>
      <label>
        Rules / notes
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={2} />
      </label>
      {kind === 'integrated' && (
        <p className="muted">An API key will be generated and shown once after creation.</p>
      )}
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button>
    </form>
  )
}
