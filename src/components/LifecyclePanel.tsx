import { useState } from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { updateEvent } from '../lib/api'
import { useEvent } from '../pages/events/EventLayout'
import { ConfirmDialog } from './ui/Dialog'
import { useToast } from './ui/Toast'
import type { EmpEvent, EventStatus } from '../lib/types'

// Manager-only lifecycle panel (ADR-0010): shows what the current status
// means and offers the sensible transitions. The lifecycle itself is the
// existing draft → active → ended → archived model — nothing new server-side;
// readiness checks are a lightweight client-side gate on activation.

const STATUS_MEANING: Record<EventStatus, string> = {
  draft: 'Hidden from participants while you configure it. Activate when ready.',
  active: 'Live — registration and participation are open according to your settings.',
  ended: 'Frozen — results stay visible, registrations and stations are closed.',
  archived: 'Historical — kept for records, hidden from ordinary listings.',
}

// what must be true before a draft goes live
function readinessChecks(event: EmpEvent): { label: string; ok: boolean }[] {
  const caps = event.capabilities
  return [
    { label: 'Event has a name', ok: event.name.trim().length > 0 },
    { label: 'Event belongs to a club', ok: event.club_id !== null },
    {
      label: 'At least one participation mode is open (solo or teams)',
      ok: caps.solo || caps.teams,
    },
    ...(caps.points
      ? [{
          label: 'Scoring unit is named',
          ok: event.currency_name.trim() !== '' && event.currency_name_plural.trim() !== '',
        }]
      : []),
    ...(caps.teams
      ? [{
          label: 'Team sizes are valid',
          ok: event.team_size_min >= 1 && event.team_size_max >= event.team_size_min,
        }]
      : []),
  ]
}

export function LifecyclePanel() {
  const { event, refresh } = useEvent()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ to: EventStatus; title: string; body: string } | null>(null)

  const checks = event.status === 'draft' ? readinessChecks(event) : []
  const ready = checks.every((c) => c.ok)

  async function setStatus(status: EventStatus, message: string) {
    setBusy(true)
    try {
      await updateEvent(event.id, { status })
      await refresh()
      toast('success', message)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Status change failed')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <section className="card stack lifecycle-panel">
      <div className="lifecycle-head">
        <h2>Event status</h2>
        <span className={`badge badge-${event.status}`}>{event.status}</span>
      </div>
      <p className="muted">{STATUS_MEANING[event.status]}</p>

      {event.status === 'draft' && (
        <>
          <ul className="readiness-list">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? 'readiness-ok' : 'readiness-missing'}>
                {c.ok
                  ? <CheckCircle2 size={16} aria-hidden />
                  : <CircleAlert size={16} aria-hidden />}
                {c.label}
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              type="button" className="btn btn-primary" disabled={!ready || busy}
              onClick={() => void setStatus('active', 'Event is now live')}
            >
              Activate event
            </button>
            {!ready && <span className="muted">Fix the items above in Event settings first.</span>}
          </div>
        </>
      )}

      {event.status === 'active' && (
        <div className="row">
          <button
            type="button" className="btn btn-ghost" disabled={busy}
            onClick={() => setConfirm({
              to: 'ended',
              title: `End "${event.name}"?`,
              body: 'Registration and scan stations close, and standings freeze as final results. You can reopen the event if needed.',
            })}
          >
            End event
          </button>
        </div>
      )}

      {event.status === 'ended' && (
        <div className="row">
          <button
            type="button" className="btn btn-ghost" disabled={busy}
            onClick={() => void setStatus('active', 'Event reopened')}
          >
            Reopen
          </button>
          <button
            type="button" className="btn btn-ghost" disabled={busy}
            onClick={() => setConfirm({
              to: 'archived',
              title: `Archive "${event.name}"?`,
              body: 'The event moves to historical records and disappears from ordinary listings. All data is kept.',
            })}
          >
            Archive
          </button>
        </div>
      )}

      {event.status === 'archived' && (
        <div className="row">
          <button
            type="button" className="btn btn-ghost" disabled={busy}
            onClick={() => void setStatus('ended', 'Event restored to Ended')}
          >
            Restore to Ended
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        confirmLabel={confirm?.to === 'archived' ? 'Archive event' : 'End event'}
        busy={busy}
        onConfirm={() => {
          if (confirm) void setStatus(confirm.to, confirm.to === 'archived' ? 'Event archived' : 'Event ended')
        }}
        onCancel={() => setConfirm(null)}
      >
        <p className="muted">{confirm?.body}</p>
      </ConfirmDialog>
    </section>
  )
}
