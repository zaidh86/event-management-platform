import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listClubs, listMyClubMemberships, listMyEvents } from '../lib/api'
import { EventCard } from '../components/EventCard'
import { useAuth } from '../contexts/AuthContext'
import { clubRoleLabel } from '../lib/roles'
import type { Club, ClubRole, EmpEvent } from '../lib/types'

function ClubCard({ club, role }: { club: Club; role: ClubRole | undefined }) {
  const label = clubRoleLabel(role)
  return (
    <Link to={`/clubs/${club.id}`} className="event-card">
      {club.banner_url && <img src={club.banner_url} alt="" className="event-card-banner" />}
      <div className="event-card-body">
        <div className="event-card-title">
          {club.logo_url && <img src={club.logo_url} alt="" className="event-card-logo" />}
          <h2>{club.name}</h2>
        </div>
        <p className="muted">{club.description || 'No description'}</p>
        {label && <div className="event-card-meta"><span className="badge">{label}</span></div>}
      </div>
    </Link>
  )
}

// Club-first home, shaped by what the signed-in person can actually do: the clubs
// they belong to, then their events, then the rest of the directory to browse.
export function HomePage() {
  const { session, isSuperAdmin, profile } = useAuth()
  const [clubs, setClubs] = useState<Club[] | null>(null)
  const [myRoles, setMyRoles] = useState<Map<string, ClubRole>>(new Map())
  const [events, setEvents] = useState<EmpEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClubs().then(setClubs).catch((e: Error) => setError(e.message))
    listMyEvents().then(setEvents).catch(() => setEvents([]))
    if (session) {
      listMyClubMemberships(session.user.id)
        .then((ms) => setMyRoles(new Map(ms.map((m) => [m.club_id, m.role]))))
        .catch(() => {})
    }
  }, [session])

  // platform admins administer every club, so all of them are "theirs"
  const myClubs = clubs?.filter((c) => isSuperAdmin || myRoles.has(c.id)) ?? null
  const otherClubs = clubs?.filter((c) => !isSuperAdmin && !myRoles.has(c.id)) ?? []
  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <div className="page">
      <div className="page-head">
        <h1>{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</h1>
        {isSuperAdmin && <Link to="/clubs/new" className="btn btn-primary">Create club</Link>}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!clubs && !error && <p className="muted">Loading…</p>}

      {myClubs && myClubs.length > 0 && (
        <>
          <h2>My clubs</h2>
          <div className="event-grid">
            {myClubs.map((club) => (
              <ClubCard key={club.id} club={club} role={myRoles.get(club.id)} />
            ))}
          </div>
        </>
      )}

      {clubs && myClubs?.length === 0 && otherClubs.length === 0 && (
        <div className="empty-state">
          <p>No clubs yet.</p>
          <p className="muted">
            {isSuperAdmin
              ? 'Create the first club to get started.'
              : 'A platform administrator sets up clubs.'}
          </p>
        </div>
      )}

      {events && events.length > 0 && (
        <>
          <h2>Recent events</h2>
          <div className="event-grid">
            {events.slice(0, 6).map((ev) => <EventCard key={ev.id} event={ev} />)}
          </div>
        </>
      )}

      {otherClubs.length > 0 && (
        <>
          <h2>Browse clubs</h2>
          <div className="event-grid">
            {otherClubs.map((club) => <ClubCard key={club.id} club={club} role={undefined} />)}
          </div>
        </>
      )}
    </div>
  )
}
