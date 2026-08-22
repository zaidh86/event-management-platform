import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  addClubMemberByEmail, listClubMembers, removeClubMember, updateClubMemberRole,
} from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { CLUB_ROLE_OPTIONS, clubRoleName, isClubAuthority, isFacultyRole } from '../../lib/roles'
import { useClub } from './ClubLayout'
import type { ClubMember, ClubRole, Profile } from '../../lib/types'

type Row = ClubMember & { profile: Profile }

export function ClubMembersPage() {
  const { club, canManage } = useClub()
  const { session } = useAuth()
  const [members, setMembers] = useState<Row[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ClubRole>('member')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toRemove, setToRemove] = useState<Row | null>(null)
  const [removing, setRemoving] = useState(false)
  // a role change that gains or loses club authority is confirmed first —
  // "Convener → Faculty" reads like a sideways move between two teacher roles
  // but is a full demotion, and the roster should not hide that
  const [toChange, setToChange] = useState<{ member: Row; next: ClubRole } | null>(null)
  const [changing, setChanging] = useState(false)

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

  function applyRoleChange(memberId: string, next: ClubRole) {
    setChanging(true)
    setError(null)
    void updateClubMemberRole(memberId, next)
      .then(() => { setToChange(null); load() })
      .catch((err: Error) => { setError(err.message); setToChange(null) })
      .finally(() => setChanging(false))
  }

  // Only a change that crosses the authority line needs confirming; Faculty →
  // Member (or Convener → Club Admin) changes the label, not what they can do.
  function onSelectRole(member: Row, next: ClubRole) {
    if (next === member.role) return
    if (isClubAuthority(member.role) === isClubAuthority(next)) {
      applyRoleChange(member.id, next)
      return
    }
    setToChange({ member, next })
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
              {CLUB_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label} — {o.hint}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary">Add</button>
        </form>
      )}
      {canManage && (
        <p className="muted">
          <strong>Convener</strong> and <strong>Faculty</strong> are both teacher
          roles. A Convener runs the club and has the same full authority as a
          Club Admin; a Faculty member is associated with the club and has no
          club authority at all.
        </p>
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
                <td>
                  {m.profile?.full_name || '—'}
                  {isFacultyRole(m.role) && <span className="badge badge-faculty">Faculty</span>}
                </td>
                <td>{m.profile?.email}</td>
                <td>
                  {canManage ? (
                    <select
                      value={m.role}
                      disabled={m.user_id === session?.user.id}
                      aria-label={`Role for ${m.profile?.email ?? 'member'}`}
                      onChange={(e) => onSelectRole(m, e.target.value as ClubRole)}
                    >
                      {CLUB_ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
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
        open={toChange !== null}
        title={
          toChange && isClubAuthority(toChange.next)
            ? `Give ${toChange.member.profile?.email} full authority over ${club.name}?`
            : `Remove ${toChange?.member.profile?.email}'s authority over ${club.name}?`
        }
        confirmLabel={toChange && isClubAuthority(toChange.next) ? 'Grant authority' : 'Remove authority'}
        danger={toChange !== null && !isClubAuthority(toChange.next)}
        busy={changing}
        onConfirm={() => toChange && applyRoleChange(toChange.member.id, toChange.next)}
        onCancel={() => setToChange(null)}
      >
        {toChange && (
          <p className="muted">
            {clubRoleName(toChange.member.role)} → <strong>{clubRoleName(toChange.next)}</strong>.
            {isClubAuthority(toChange.next)
              ? ' They will be able to edit the club, manage its members, and create, edit and delete its events.'
              : ' They stay in the club but can no longer edit it, manage members, or manage its events.'}
          </p>
        )}
      </ConfirmDialog>

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
