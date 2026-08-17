import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listClubEvents } from '../../lib/api'
import { EventCard } from '../../components/EventCard'
import { useClub } from './ClubLayout'
import type { EmpEvent } from '../../lib/types'

export function ClubEventsPage() {
  const { club, canManage } = useClub()
  const [events, setEvents] = useState<EmpEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClubEvents(club.id).then(setEvents).catch((e: Error) => setError(e.message))
  }, [club.id])

  return (
    <div className="page">
      <div className="page-head">
        <h2>Events</h2>
        {canManage && <Link to="new" className="btn btn-primary">Create event</Link>}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!events && !error && <p className="muted">Loading…</p>}
      {events && events.length === 0 && (
        <div className="empty-state">
          <p>No events yet.</p>
          {canManage && <p className="muted">Create the club's first event to get started.</p>}
        </div>
      )}
      <div className="event-grid">
        {events?.map((ev) => <EventCard key={ev.id} event={ev} />)}
      </div>
    </div>
  )
}
