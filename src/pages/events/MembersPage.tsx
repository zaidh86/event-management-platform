import { useEffect, useState, type FormEvent } from 'react'
import {
  addMemberByEmail, listMembers, listParticipants, listTeams, removeMember,
  updateMemberRole,
} from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { useEvent } from './EventLayout'
import type { EventMember, EventRole, Participant, Profile, Team } from '../../lib/types'

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
  const [toRemove, setToRemove] = useState<(EventMember & { profile: Profile }) | null>(null)
  const [removing, setRemoving] = useState(false)

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

  // the tab is hidden for non-organizers; this also covers arriving by URL
  if (!isOrganizer) {
    return (
      <div className="page">
        <p className="form-error">You don't have permission to manage this event's members.</p>
      </div>
    )
  }

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
            <tr><th>Participant</th><th>Registered as</th><th>Registered</th></tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              // the STORED participation mode is the source of truth (ADR-0007)
              const teamName = p.team_id ? teams.find((t) => t.id === p.team_id)?.name : null
              return (
                <tr key={p.id}>
                  <td>{p.display_name}</td>
                  <td>
                    {p.participation_mode === 'team'
                      ? `Team${teamName ? ` — ${teamName}` : ' (no team yet)'}`
                      : 'Solo'}
                  </td>
                  <td className="muted">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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
