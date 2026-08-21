import { useCallback, useEffect, useState } from 'react'
import { Award, BadgeCheck } from 'lucide-react'
import {
  issueCertificates, listCertificates, listParticipants, listTeams, revokeCertificate,
} from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useEvent } from './EventLayout'
import type { Certificate, CertificateKind, Participant, Team } from '../../lib/types'

type Scope = 'registered' | 'attended' | 'participant' | 'team'

// Certificates (ADR-0012): Event Managers issue universal certificates
// (participation / achievement / completion) to registered or attended
// participants, one participant, or one team. Each carries a public verify
// code; holders see theirs on the dashboard, anyone can verify at /cert/:code.
export function CertificatesPage() {
  const { event, canManageEvent } = useEvent()
  const toast = useToast()
  const [certs, setCerts] = useState<Certificate[] | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [kind, setKind] = useState<CertificateKind>('participation')
  const [title, setTitle] = useState('Certificate of Participation')
  const [detail, setDetail] = useState('')
  const [scope, setScope] = useState<Scope>('registered')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<Certificate | null>(null)

  const reload = useCallback(() => {
    listCertificates(event.id).then(setCerts).catch(() => setCerts([]))
  }, [event.id])

  useEffect(() => {
    if (!canManageEvent) return
    reload()
    listParticipants(event.id).then(setParticipants).catch(() => {})
    if (event.capabilities.teams) listTeams(event.id).then(setTeams).catch(() => {})
  }, [reload, event.id, event.capabilities.teams, canManageEvent])

  if (!canManageEvent) {
    return (
      <div className="page">
        <p className="form-error">Only Event Managers can manage certificates.</p>
      </div>
    )
  }

  async function issue() {
    if (busy) return
    setBusy(true)
    try {
      const result = await issueCertificates({
        eventId: event.id, kind, title, detail,
        scope, targetId: scope === 'participant' || scope === 'team' ? targetId : undefined,
      })
      toast('success', `${result.issued} issued${result.skipped > 0 ? `, ${result.skipped} already had it` : ''}`)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Issue failed')
    } finally {
      setBusy(false)
    }
  }

  async function doRevoke() {
    if (!confirmRevoke) return
    setBusy(true)
    try {
      await revokeCertificate(confirmRevoke.id)
      toast('success', 'Certificate revoked')
      setConfirmRevoke(null)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Revoke failed')
      setConfirmRevoke(null)
    } finally {
      setBusy(false)
    }
  }

  const holderName = (c: Certificate) =>
    c.team_id
      ? teams.find((t) => t.id === c.team_id)?.name ?? 'Team'
      : participants.find((p) => p.id === c.participant_id)?.display_name ?? 'Participant'

  const needsTarget = scope === 'participant' || scope === 'team'

  return (
    <div className="page page-narrow">
      <h2>Certificates</h2>

      <section className="card stack">
        <h3>Issue certificates</h3>
        <div className="row">
          <label>
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as CertificateKind)}>
              <option value="participation">Participation</option>
              <option value="completion">Completion</option>
              <option value="achievement">Achievement</option>
            </select>
          </label>
          <label>
            Issue to
            <select value={scope} onChange={(e) => { setScope(e.target.value as Scope); setTargetId('') }}>
              <option value="registered">All registered participants</option>
              {event.capabilities.attendance && <option value="attended">All checked-in participants</option>}
              <option value="participant">One participant</option>
              {event.capabilities.teams && <option value="team">One team</option>}
            </select>
          </label>
        </div>
        {needsTarget && (
          <label>
            {scope === 'team' ? 'Team' : 'Participant'}
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Select…</option>
              {scope === 'team'
                ? teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)
                : participants.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
          </label>
        )}
        <label>
          Certificate title
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Detail (optional — e.g. "Winner — 1st place")
          <input value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <div className="row">
          <button
            className="btn btn-primary" disabled={busy || !title.trim() || (needsTarget && !targetId)}
            onClick={() => void issue()}
          >
            <Award size={16} aria-hidden /> {busy ? 'Issuing…' : 'Issue'}
          </button>
        </div>
        <p className="muted">
          Re-issuing is safe: holders who already have this exact certificate are skipped.
        </p>
      </section>

      <section className="card stack">
        <h3>Issued</h3>
        {certs === null && <Skeleton lines={2} height="2.2rem" />}
        {certs !== null && certs.length === 0 && (
          <EmptyState icon={BadgeCheck} title="No certificates issued yet" />
        )}
        {certs !== null && certs.length > 0 && (
          <ul className="admin-list">
            {certs.map((c) => (
              <li key={c.id}>
                <span className="admin-list-who">
                  <BadgeCheck size={16} aria-hidden className="featured-star" />
                  <span>
                    <strong>{holderName(c)}</strong>
                    <span className="muted"> · {c.title}{c.detail ? ` — ${c.detail}` : ''} · {fmtDateTime(c.created_at)}</span>
                  </span>
                </span>
                <span className="row">
                  <a className="btn btn-ghost btn-sm" href={`/cert/${c.verify_code}`} target="_blank" rel="noreferrer">
                    View ↗
                  </a>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRevoke(c)}>Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmRevoke !== null}
        title="Revoke this certificate?"
        confirmLabel="Revoke"
        busy={busy}
        onConfirm={() => void doRevoke()}
        onCancel={() => setConfirmRevoke(null)}
      >
        <p className="muted">
          Its verification link stops working immediately. The holder will no
          longer see it on their dashboard.
        </p>
      </ConfirmDialog>
    </div>
  )
}
