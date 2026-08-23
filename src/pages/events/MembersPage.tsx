import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  addMemberByEmail, listMembers, listParticipants, listTeams, removeEventParticipant,
  removeMember, updateMemberRole,
} from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { useEvent } from './EventLayout'
import type {
  EventMember, EventRole, Participant, ParticipantRemovalResult, Profile, Team,
} from '../../lib/types'

const ROLES: EventRole[] = ['organizer', 'activity_admin', 'volunteer', 'judge', 'participant']

export function MembersPage() {
  const { event, isOrganizer } = useEvent()
  const { session } = useAuth()
  const [members, setMembers] = useState<(EventMember & { profile: Profile })[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<EventRole>('volunteer')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The contact column comes from the event's OWN registration form: the
  // first configured field that reads like a mobile/phone number. Its value
  // lives in participants.registration_data under that field's key — no
  // schema, no hardcoded key. Events without such a field show no column.
  const mobileField = event.registration_fields.find((f) => /mobile|phone|contact/i.test(f.label))
  const [toRemove, setToRemove] = useState<(EventMember & { profile: Profile }) | null>(null)
  const [removing, setRemoving] = useState(false)

  // participant removal is a two-step conversation with the server: the first
  // call reports what removal would destroy, and only an explicit second call
  // carrying a reason goes through. Nothing is decided here — the RPC re-checks
  // authority and re-evaluates every refusal on the forced call too.
  const [toUnregister, setToUnregister] = useState<Participant | null>(null)
  const [block, setBlock] = useState<ParticipantRemovalResult | null>(null)
  const [reason, setReason] = useState('')
  const [unregistering, setUnregistering] = useState(false)
  // which participant the dialog is currently about, readable from inside an
  // async handler: a result that lands after the dialog moved on must not be
  // applied to whoever is on screen now
  const openFor = useRef<string | null>(null)

  function load() {
    listMembers(event.id).then(setMembers).catch((e: Error) => setError(e.message))
    listParticipants(event.id).then(setParticipants).catch(() => {})
    listTeams(event.id).then(setTeams).catch(() => {})
  }
  useEffect(load, [event.id])

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    try {
      await addMemberByEmail(event.id, email, role)
      setNotice(`Added ${email} as ${role.replace('_', ' ')}.`)
      setEmail('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
    }
  }

  function openUnregister(p: Participant) {
    openFor.current = p.id
    setToUnregister(p)
    setBlock(null)
    setReason('')
    setError(null)
    setNotice(null)
  }

  function closeUnregister() {
    openFor.current = null
    setToUnregister(null)
    setBlock(null)
    setReason('')
  }

  async function confirmUnregister() {
    const target = toUnregister
    if (!target) return
    // a hard refusal has no second step — acknowledging it just closes
    if (block && !block.override_allowed) {
      closeUnregister()
      return
    }
    const forcing = block?.override_allowed === true
    setUnregistering(true)
    setError(null)
    try {
      const result = await removeEventParticipant(target.id, reason.trim(), forcing)
      // the dialog moved on while this was in flight: the write still happened,
      // so refresh, but do not narrate it over a different participant
      if (openFor.current !== target.id) {
        load()
        return
      }
      if (result.status === 'blocked') {
        setBlock(result)
        return
      }
      const extras: string[] = []
      if (result.certificates_deleted) extras.push(`${result.certificates_deleted} certificate(s) revoked`)
      if (result.transactions_deleted) extras.push(`${result.transactions_deleted} ledger entrie(s) deleted`)
      if (result.team_now_empty) extras.push('their team now has no members')
      setNotice(
        `${result.display_name} was removed from this event${extras.length ? ` — ${extras.join(', ')}` : ''}.`,
      )
      closeUnregister()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove participant')
      closeUnregister()
    } finally {
      setUnregistering(false)
    }
  }

  // the tab is hidden for non-organizers; this also covers arriving by URL
  if (!isOrganizer) {
    return (
      <div className="page">
        <p className="form-error">You don't have permission to manage this event's members.</p>
      </div>
    )
  }

  const forcing = block?.override_allowed === true

  return (
    <div className="page">
      <h2>Members &amp; roles</h2>
      <form onSubmit={(e) => void onAdd(e)} className="card row member-add">
        <label>
          Email (must have an EMP account)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as EventRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select>
        </label>
        <button className="btn btn-primary">Add</button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-notice">{notice}</p>}

      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th /></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.profile?.full_name || '—'}</td>
                <td>{m.profile?.email}</td>
                <td>
                  <select
                    value={m.role}
                    disabled={m.user_id === session?.user.id}
                    onChange={(e) => {
                      void updateMemberRole(m.id, e.target.value).then(load).catch((err: Error) => setError(err.message))
                    }}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                  </select>
                </td>
                <td>
                  {m.user_id !== session?.user.id && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setToRemove(m)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Registered participants ({participants.length})</h3>
      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Participant</th><th>Registered as</th>
              {mobileField && <th>{mobileField.label}</th>}
              <th>Registered</th><th />
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              // the STORED participation mode is the source of truth (ADR-0007)
              const teamName = p.team_id ? teams.find((t) => t.id === p.team_id)?.name : null
              const mobile = mobileField ? String(p.registration_data?.[mobileField.key] ?? '').trim() : ''
              return (
                <tr key={p.id}>
                  <td>{p.display_name}</td>
                  <td>
                    {p.participation_mode === 'team'
                      ? `Team${teamName ? ` — ${teamName}` : ' (no team yet)'}`
                      : 'Solo'}
                  </td>
                  {mobileField && <td className="nowrap">{mobile || '—'}</td>}
                  <td className="muted">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openUnregister(p)}
                      title="Remove this registration from this event"
                    >
                      Remove from event
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {participants.length === 0 && <p className="muted">Nobody has registered yet.</p>}
      </div>

      <ConfirmDialog
        open={toUnregister !== null}
        title={`Remove ${toUnregister?.display_name ?? ''} from ${event.name}?`}
        confirmLabel={
          block && !block.override_allowed ? 'Close'
            : forcing ? 'Remove anyway'
              : 'Remove from event'
        }
        cancelLabel={block && !block.override_allowed ? 'Back' : 'Cancel'}
        danger
        busy={unregistering}
        confirmDisabled={forcing && reason.trim() === ''}
        onConfirm={() => void confirmUnregister()}
        onCancel={closeUnregister}
      >
        {!block && (
          <>
            <p className="muted">
              This removes their registration from <strong>this event only</strong> —
              their check-in and, for a solo participant, their points account go
              with it.
            </p>
            <p className="muted">
              It does <strong>not</strong> delete their EMP account, their club
              membership, or their registrations in any other event. They can
              register again while the event is active.
            </p>
          </>
        )}
        {block && (
          <>
            <p className={block.override_allowed ? 'form-notice' : 'form-error'}>
              {block.override_allowed
                ? 'Removing them would also destroy:'
                : 'This participant cannot be removed:'}
            </p>
            <ul className="muted">
              {(block.reasons ?? []).map((r) => <li key={r}>{r}</li>)}
            </ul>
            {block.hint && <p className="muted">{block.hint}</p>}
            {block.override_allowed && (
              <label>
                Reason (recorded in the removal log, required)
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. duplicate registration"
                />
              </label>
            )}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={toRemove !== null}
        title={`Remove ${toRemove?.profile?.email}?`}
        confirmLabel="Remove member"
        danger
        busy={removing}
        onConfirm={() => {
          if (!toRemove) return
          setRemoving(true)
          void removeMember(toRemove.id)
            .then(() => { setToRemove(null); load() })
            .catch((err: Error) => setError(err.message))
            .finally(() => setRemoving(false))
        }}
        onCancel={() => setToRemove(null)}
      >
        <p className="muted">They lose their event role. Their participant registration, if any, is unaffected.</p>
      </ConfirmDialog>
    </div>
  )
}
