import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { getEvent, getMyMembership, getMyParticipant } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import type { EmpEvent, EventRole, Participant } from '../../lib/types'

export interface EventContext {
  event: EmpEvent
  role: EventRole | null
  isOrganizer: boolean
  isStaff: boolean
  participant: Participant | null
  refresh: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEvent(): EventContext {
  return useOutletContext<EventContext>()
}

export function EventLayout() {
  const { eventId } = useParams<{ eventId: string }>()
  const { session, isSuperAdmin } = useAuth()
  const [event, setEvent] = useState<EmpEvent | null>(null)
  const [role, setRole] = useState<EventRole | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!eventId || !session) return
    try {
      const [ev, membership, part] = await Promise.all([
        getEvent(eventId),
        getMyMembership(eventId, session.user.id),
        getMyParticipant(eventId, session.user.id),
      ])
      if (!ev) {
        setError('Event not found (or you do not have access).')
        return
      }
      setEvent(ev)
      setRole(membership?.role ?? null)
      setParticipant(part)
      setError(null)
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

  const ctx: EventContext = { event, role, isOrganizer, isStaff, participant, refresh }

  return (
    <div className="event-shell" style={{ ['--theme' as string]: event.theme_color }}>
      <div className="event-header">
        {event.logo_url && <img src={event.logo_url} alt="" className="event-logo" />}
        <div>
          <h1>{event.name}</h1>
          <span className={`badge badge-${event.status}`}>{event.status}</span>
          {role && <span className="badge">{role.replace('_', ' ')}</span>}
        </div>
      </div>
      <nav className="event-tabs">
        <NavLink to="" end>Overview</NavLink>
        <NavLink to="leaderboard">Leaderboard</NavLink>
        {(role === 'participant' || !role) && <NavLink to="dashboard">My dashboard</NavLink>}
        {isStaff && <NavLink to="scan">Scan</NavLink>}
        {isStaff && <NavLink to="activities">Activities</NavLink>}
        {isOrganizer && <NavLink to="members">Members</NavLink>}
        {isOrganizer && <NavLink to="settings">Settings</NavLink>}
      </nav>
      <Outlet context={ctx} />
    </div>
  )
}
