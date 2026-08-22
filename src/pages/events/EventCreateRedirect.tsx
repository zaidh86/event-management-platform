import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listClubs, listMyClubMemberships } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { isClubAuthority } from '../../lib/roles'
import type { Club } from '../../lib/types'

// Events belong to a club, so the legacy top-level create route no longer creates
// anything — it routes into the club-first flow, or explains why it can't.
export function EventCreateRedirect() {
  const { session, isSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const [clubs, setClubs] = useState<Club[] | null>(null)

  useEffect(() => {
    if (!session) return
    Promise.all([listClubs(), listMyClubMemberships(session.user.id)])
      .then(([all, memberships]) => {
        const adminOf = new Set(
          memberships.filter((m) => isClubAuthority(m.role)).map((m) => m.club_id),
        )
        // mirrors events_insert: a club you administer, or any club for platform admins
        setClubs(isSuperAdmin ? all : all.filter((c) => adminOf.has(c.id)))
      })
      .catch(() => setClubs([]))
  }, [session, isSuperAdmin])

  const only = clubs?.length === 1 ? clubs[0] : null
  useEffect(() => {
    if (only) navigate(`/clubs/${only.id}/events/new`, { replace: true })
  }, [only, navigate])

  if (!clubs || only) return <div className="page-loading">Loading…</div>

  if (clubs.length === 0) {
    return (
      <div className="page page-narrow">
        <h1>Events belong to a club</h1>
        <div className="empty-state">
          <p>You don't manage a club yet.</p>
          <p className="muted">
            Every event is created inside a club. Ask a club admin to make you an
            admin of theirs, or ask a platform administrator to set your club up.
          </p>
          <Link to="/" className="btn btn-ghost">Back to home</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <h1>Choose a club</h1>
      <p className="muted">Events are created inside a club. Pick the one running this event.</p>
      <div className="stack">
        {clubs.map((club) => (
          <Link key={club.id} to={`/clubs/${club.id}/events/new`} className="card club-pick">
            <strong>{club.name}</strong>
            {club.description && <p className="muted">{club.description}</p>}
          </Link>
        ))}
      </div>
    </div>
  )
}
