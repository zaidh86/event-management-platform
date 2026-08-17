import { Link } from 'react-router-dom'
import type { EmpEvent } from '../lib/types'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', active: 'Active', ended: 'Ended', archived: 'Archived',
}

// Shared event card used by Home, Club Overview and Club Events.
export function EventCard({ event }: { event: EmpEvent }) {
  return (
    <Link to={`/events/${event.id}`} className="event-card" style={{ borderTopColor: event.theme_color }}>
      {event.banner_url && <img src={event.banner_url} alt="" className="event-card-banner" />}
      <div className="event-card-body">
        <div className="event-card-title">
          {event.logo_url && <img src={event.logo_url} alt="" className="event-card-logo" />}
          <h2>{event.name}</h2>
        </div>
        <p className="muted">{event.description || 'No description'}</p>
        <div className="event-card-meta">
          <span className={`badge badge-${event.status}`}>{STATUS_LABEL[event.status]}</span>
          <span className="badge">
            {event.is_team_event ? `Teams of ${event.team_size_min}–${event.team_size_max}` : 'Individual'}
          </span>
        </div>
      </div>
    </Link>
  )
}
