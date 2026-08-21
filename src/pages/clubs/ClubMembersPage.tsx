import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  addClubMemberByEmail, listClubMembers, removeClubMember, updateClubMemberRole,
} from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { CLUB_ROLE_OPTIONS, clubRoleName } from '../../lib/roles'
import { useClub } from './ClubLayout'
import type { ClubMember, ClubRole, Profile } from '../../lib/types'

export function ClubMembersPage() {
  const { club, canManage } = useClub()
  const { session } = useAuth()
  const [members, setMembers] = useState<(ClubMember & { profile: Profile })[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ClubRole>('member')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toRemove, setToRemove] = useState<(ClubMember & { profile: Profile }) | null>(null)
  const [removing, setRemoving] = useState(false)

  const load = useCallback(() => {
    listClubMembers(club.id).then(setMembers).catch((e: Error) => setError(e.message))
  }, [club.id])
  useEffect(load, [load])

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    try {
      await addClubMemberByEmail(club.id, email, role)
      setNotice(`Added ${email} as ${clubRoleName(role)}.`)
      setEmail('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member')
    }
  }

  return (
    <div className="page">
      <h2>Members</h2>
      {canManage && (
        <form onSubmit={(e) => void onAdd(e)} className="card row member-add">
          <label>
            Email (must have an EMP account)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as ClubRole)}>
              {CLUB_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary">Add</button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-notice">{notice}</p>}

      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th>{canManage && <th />}</tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.profile?.full_name || '—'}</td>
                <td>{m.profile?.email}</td>
                <td>
                  {canManage ? (
                    <select
                      value={m.role}
                      disabled={m.user_id === session?.user.id}
                      onChange={(e) => {
                        // promote member → club_admin, or demote club_admin → member
                        void updateClubMemberRole(m.id, e.target.value as ClubRole)
                          .then(load).catch((err: Error) => setError(err.message))
                      }}
                    >
                      {CLUB_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    clubRoleName(m.role)
                  )}
                </td>
                {canManage && (
                  <td>
                    {m.user_id !== session?.user.id && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setToRemove(m)}>
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 && <p className="muted">No members yet.</p>}
      </div>

      <ConfirmDialog
        open={toRemove !== null}
        title={`Remove ${toRemove?.profile?.email} from ${club.name}?`}
        confirmLabel="Remove member"
        danger
        busy={removing}
        onConfirm={() => {
          if (!toRemove) return
          setRemoving(true)
          void removeClubMember(toRemove.id)
            .then(() => { setToRemove(null); load() })
            .catch((err: Error) => setError(err.message))
            .finally(() => setRemoving(false))
        }}
        onCancel={() => setToRemove(null)}
      >
        <p className="muted">They lose their club role. Event registrations they already made are unaffected.</p>
      </ConfirmDialog>
    </div>
  )
}
