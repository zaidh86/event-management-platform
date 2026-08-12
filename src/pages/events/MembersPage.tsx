import { useEffect, useState, type FormEvent } from 'react'
import {
  addMemberByEmail, listMembers, listParticipants, removeMember, updateMemberRole,
} from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { useEvent } from './EventLayout'
import type { EventMember, EventRole, Participant, Profile } from '../../lib/types'

const ROLES: EventRole[] = ['organizer', 'activity_admin', 'volunteer', 'participant']

export function MembersPage() {
  const { event } = useEvent()
  const { session } = useAuth()
  const [members, setMembers] = useState<(EventMember & { profile: Profile })[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<EventRole>('volunteer')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function load() {
    listMembers(event.id).then(setMembers).catch((e: Error) => setError(e.message))
    listParticipants(event.id).then(setParticipants).catch(() => {})
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

      <div className="card">
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
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (confirm(`Remove ${m.profile?.email} from the event?`)) {
                          void removeMember(m.id).then(load).catch((err: Error) => setError(err.message))
                        }
                      }}
                    >
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
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Display name</th><th>Registration data</th><th>Registered</th></tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id}>
                <td>{p.display_name}</td>
                <td className="muted">
                  {Object.entries(p.registration_data).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || '—'}
                </td>
                <td className="muted">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
