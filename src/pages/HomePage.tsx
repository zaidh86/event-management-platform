import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, UsersRound } from 'lucide-react'
import { listClubs, listFeaturedEvents, listMyClubMemberships } from '../lib/api'
import { EventCard } from '../components/EventCard'
import { EmptyState } from '../components/ui/EmptyState'
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
        {/* concise identity on listings; the full description lives in the
            club's Overview page (Informatique Exhib pass, issue 3) */}
        {club.department
          ? <p className="club-dept">{club.department}</p>
          : <p className="muted">Club</p>}
        {label && <div className="event-card-meta"><span className="badge">{label}</span></div>}
      </div>
    </Link>
  )
}

// Home (ADR-0010): welcome → featured events (platform curation) → clubs →
// about. Event lifecycle lists (ongoing/previous) live inside clubs, not here.
export function HomePage() {
  const { session, isSuperAdmin, profile } = useAuth()
  const [clubs, setClubs] = useState<Club[] | null>(null)
  const [myRoles, setMyRoles] = useState<Map<string, ClubRole>>(new Map())
  const [featured, setFeatured] = useState<EmpEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClubs().then(setClubs).catch((e: Error) => setError(e.message))
    listFeaturedEvents().then(setFeatured).catch(() => setFeatured([]))
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
        <h1>{session ? (firstName ? `Welcome back, ${firstName}` : 'Welcome back') : 'Welcome to EMP'}</h1>
        {isSuperAdmin && <Link to="/clubs/new" className="btn btn-primary">Create club</Link>}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!clubs && !error && <p className="muted">Loading…</p>}

      <section className="home-section">
        <h2 className="home-featured-title"><Sparkles size={18} aria-hidden /> Featured events</h2>
        {featured === null && <p className="muted">Loading…</p>}
        {featured !== null && featured.length === 0 && (
          <EmptyState
            icon={Sparkles}
            title="No featured events right now"
            hint="Events highlighted by the platform appear here."
          />
        )}
        {featured !== null && featured.length > 0 && (
          <div className="event-grid">
            {featured.slice(0, 6).map((ev) => <EventCard key={ev.id} event={ev} />)}
          </div>
        )}
      </section>

      {myClubs && myClubs.length > 0 && (
        <section className="home-section">
          <h2>My clubs</h2>
          <div className="event-grid">
            {myClubs.map((club) => (
              <ClubCard key={club.id} club={club} role={myRoles.get(club.id)} />
            ))}
          </div>
        </section>
      )}

      {clubs && myClubs?.length === 0 && otherClubs.length === 0 && (
        <EmptyState
          icon={UsersRound}
          title="No clubs yet"
          hint={isSuperAdmin
            ? 'Create the first club to get started.'
            : 'A platform administrator sets up clubs.'}
        />
      )}

      {otherClubs.length > 0 && (
        <section className="home-section">
          <h2>Browse clubs</h2>
          <div className="event-grid">
            {otherClubs.map((club) => <ClubCard key={club.id} club={club} role={undefined} />)}
          </div>
        </section>
      )}

      <footer className="about-emp">
        <h2>About EMP</h2>
        <p className="muted">
          EMP is a centralized event management platform that helps colleges,
          clubs, organizers and participants run events, registrations,
          participation and event operations from one place.
        </p>
      </footer>
    </div>
  )
}
