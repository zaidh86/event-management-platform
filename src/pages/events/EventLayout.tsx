import { Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { getClub, getEvent, getMyMembership, getMyParticipant, listMyClubMemberships } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { normalizeLeaderboardConfig } from '../../lib/leaderboard'
import { clubRoleLabel, eventRoleLabel, isClubAuthority, platformRoleLabel } from '../../lib/roles'
import type { Club, ClubRole, EmpEvent, EventRole, Participant } from '../../lib/types'

export interface EventContext {
  event: EmpEvent
  role: EventRole | null
  isOrganizer: boolean
  isStaff: boolean
  // club-admin standing over the event's club, platform admins included —
  // mirrors is_club_admin(event.club_id) in SQL; this is who may delete
  isClubAdmin: boolean
  // who may configure the event: its organizers, or club admins of its club
  canManageEvent: boolean
  participant: Participant | null
  refresh: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEvent(): EventContext {
  return useOutletContext<EventContext>()
}

export function EventLayout() {
  const { eventId } = useParams<{ eventId: string }>()
  const { session, isSuperAdmin, profile } = useAuth()
  const [event, setEvent] = useState<EmpEvent | null>(null)
  const [club, setClub] = useState<Club | null>(null)
  const [role, setRole] = useState<EventRole | null>(null)
  const [myClubRole, setMyClubRole] = useState<ClubRole | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!eventId) return
    try {
      // public-first: active/ended events load for signed-out visitors too
      // (anon RLS, 00019); membership context only exists with a session
      const [ev, membership, part, clubMemberships] = await Promise.all([
        getEvent(eventId),
        session ? getMyMembership(eventId, session.user.id) : Promise.resolve(null),
        session ? getMyParticipant(eventId, session.user.id) : Promise.resolve(null),
        session ? listMyClubMemberships(session.user.id) : Promise.resolve([]),
      ])
      if (!ev) {
        setError('Event not found (or you do not have access).')
        return
      }
      setEvent(ev)
      setRole(membership?.role ?? null)
      setParticipant(part)
      setMyClubRole(
        ev.club_id
          ? clubMemberships.find((m) => m.club_id === ev.club_id)?.role ?? null
          : null,
      )
      setError(null)
      // owning club, for the breadcrumb (non-fatal if unreadable)
      if (ev.club_id) {
        getClub(ev.club_id).then(setClub).catch(() => setClub(null))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load event')
    } finally {
      setLoaded(true)
    }
  }, [eventId, session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (error) return <div className="page"><p className="form-error">{error}</p></div>
  if (!loaded || !event) return <div className="page-loading">Loading event…</div>

  const isOrganizer = role === 'organizer' || isSuperAdmin
  const isStaff = isOrganizer || role === 'activity_admin' || role === 'volunteer'
  const isClubAdmin = isSuperAdmin || isClubAuthority(myClubRole)
  const canManageEvent = isOrganizer || isClubAdmin
  const caps = event.capabilities
  // event.leaderboard_config is already normalized at the api boundary; the
  // helper is re-applied defensively for contexts constructing events manually
  const lb = normalizeLeaderboardConfig(event.leaderboard_config, caps, event.public_leaderboard)
  const showLeaderboardTab = lb.enabled && (lb.visibility !== 'hidden' || isStaff)

  const ctx: EventContext = {
    event, role, isOrganizer, isStaff, isClubAdmin, canManageEvent, participant, refresh,
  }

  return (
    <div className="event-shell" style={{ ['--theme' as string]: event.theme_color }}>
      {event.club_id && (
        <p className="breadcrumb">
          <Link to={`/clubs/${event.club_id}`}>← {club?.name ?? 'Club'}</Link>
        </p>
      )}
      <div className="event-header">
        {event.logo_url && <img src={event.logo_url} alt="" className="event-logo" />}
        <div>
          <h1>{event.name}</h1>
          <span className={`badge badge-${event.status}`}>{event.status}</span>
          {eventRoleLabel(role) && <span className="badge">{eventRoleLabel(role)}</span>}
          {isSuperAdmin && !role && (
            <span className="badge badge-admin">{platformRoleLabel(profile?.role)}</span>
          )}
          {!isSuperAdmin && !role && clubRoleLabel(myClubRole) && (
            <span className="badge">{clubRoleLabel(myClubRole)}</span>
          )}
        </div>
      </div>
      <nav className="event-tabs">
        <NavLink to="" end>Overview</NavLink>
        {showLeaderboardTab && <NavLink to="leaderboard">Leaderboard</NavLink>}
        {/* registered people always get their dashboard; everyone else sees it only
            if they could still register (staff aren't shown a registration form) */}
        {(participant || !isStaff) && (
          <NavLink to="dashboard">{participant ? 'My dashboard' : 'Register'}</NavLink>
        )}
        {isStaff && caps.qr && <NavLink to="scan">Scan</NavLink>}
        {isStaff && <NavLink to="activities">Tasks</NavLink>}
        {canManageEvent && caps.feedback && <NavLink to="feedback">Feedback</NavLink>}
        {caps.judging && (isStaff || role === 'judge') && <NavLink to="judging">Judging</NavLink>}
        {canManageEvent && <NavLink to="analytics">Analytics</NavLink>}
        {canManageEvent && caps.certificates && <NavLink to="certificates">Certificates</NavLink>}
        {isOrganizer && <NavLink to="members">Members</NavLink>}
        {canManageEvent && <NavLink to="settings">Settings</NavLink>}
      </nav>
      <Suspense fallback={<div className="page-loading">Loading…</div>}>
        <Outlet context={ctx} />
      </Suspense>
    </div>
  )
}
