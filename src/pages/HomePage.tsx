import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listMyEvents } from '../lib/api'
import type { EmpEvent } from '../lib/types'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', active: 'Active', ended: 'Ended', archived: 'Archived',
}

export function HomePage() {
  const [events, setEvents] = useState<EmpEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listMyEvents().then(setEvents).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <h1>Events</h1>
        <Link to="/events/new" className="btn btn-primary">Create event</Link>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!events && !error && <p className="muted">Loading…</p>}
      {events && events.length === 0 && (
        <div className="empty-state">
          <p>No events yet.</p>
          <p className="muted">Create one, or ask an organizer to open registration.</p>
        </div>
      )}
      <div className="event-grid">
        {events?.map((ev) => (
          <Link key={ev.id} to={`/events/${ev.id}`} className="event-card" style={{ borderTopColor: ev.theme_color }}>
            {ev.banner_url && <img src={ev.banner_url} alt="" className="event-card-banner" />}
            <div className="event-card-body">
              <div className="event-card-title">
                {ev.logo_url && <img src={ev.logo_url} alt="" className="event-card-logo" />}
                <h2>{ev.name}</h2>
              </div>
              <p className="muted">{ev.description || 'No description'}</p>
              <div className="event-card-meta">
                <span className={`badge badge-${ev.status}`}>{STATUS_LABEL[ev.status]}</span>
                <span className="badge">{ev.is_team_event ? `Teams of ${ev.team_size_min}–${ev.team_size_max}` : 'Individual'}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
