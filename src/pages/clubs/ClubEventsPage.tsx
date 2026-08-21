import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, CalendarDays, History } from 'lucide-react'
import { listClubEvents } from '../../lib/api'
import { EventCard } from '../../components/EventCard'
import { EmptyState } from '../../components/ui/EmptyState'
import { useClub } from './ClubLayout'
import type { EmpEvent } from '../../lib/types'

// Club events grouped by real lifecycle status (ADR-0010): ongoing (active),
// previous (ended), and — for club managers only — drafts & archived. RLS
// already hides draft events from non-members; the grouping mirrors it.
export function ClubEventsPage() {
  const { club, canManage } = useClub()
  const [events, setEvents] = useState<EmpEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClubEvents(club.id).then(setEvents).catch((e: Error) => setError(e.message))
  }, [club.id])

  const ongoing = events?.filter((e) => e.status === 'active') ?? []
  const previous = events?.filter((e) => e.status === 'ended') ?? []
  const managed = events?.filter((e) => e.status === 'draft' || e.status === 'archived') ?? []

  return (
    <div className="page">
      <div className="page-head">
        <h2>Events</h2>
        {canManage && <Link to="new" className="btn btn-primary">Create event</Link>}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!events && !error && <p className="muted">Loading…</p>}

      {events && (
        <>
          <section className="home-section">
            <h3>Ongoing events</h3>
            {ongoing.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No ongoing events"
                hint={canManage
                  ? 'Activate a draft event, or create a new one.'
                  : 'Check back when the club announces its next event.'}
                action={canManage && events.length === 0 && (
                  <Link to="new" className="btn btn-primary">Create event</Link>
                )}
              />
            ) : (
              <div className="event-grid">
                {ongoing.map((ev) => <EventCard key={ev.id} event={ev} />)}
              </div>
            )}
          </section>

          <section className="home-section">
            <h3>Previous events</h3>
            {previous.length === 0 ? (
              <EmptyState
                icon={History}
                title="No previous events"
                hint="Ended events are kept here with their results."
              />
            ) : (
              <div className="event-grid">
                {previous.map((ev) => <EventCard key={ev.id} event={ev} />)}
              </div>
            )}
          </section>

          {canManage && managed.length > 0 && (
            <section className="home-section">
              <h3><Archive size={16} aria-hidden /> Drafts &amp; archived</h3>
              <p className="muted">Visible to club managers only.</p>
              <div className="event-grid">
                {managed.map((ev) => <EventCard key={ev.id} event={ev} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
