import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listClubEvents } from '../../lib/api'
import { EventCard } from '../../components/EventCard'
import { useClub } from './ClubLayout'
import type { EmpEvent } from '../../lib/types'

export function ClubOverviewPage() {
  const { club } = useClub()
  const [events, setEvents] = useState<EmpEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClubEvents(club.id).then(setEvents).catch((e: Error) => setError(e.message))
  }, [club.id])

  return (
    <div className="page">
      {club.banner_url && <img src={club.banner_url} alt="" className="event-banner" />}
      {club.description && <p className="event-description">{club.description}</p>}
      <div className="page-head">
        <h2>Recent events</h2>
        <Link to="events" className="btn btn-ghost btn-sm">All events</Link>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!events && !error && <p className="muted">Loading…</p>}
      {events && events.length === 0 && (
        <div className="empty-state"><p>No events yet.</p></div>
      )}
      <div className="event-grid">
        {events?.slice(0, 6).map((ev) => <EventCard key={ev.id} event={ev} />)}
      </div>
    </div>
  )
}
