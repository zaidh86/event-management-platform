import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getEventBySlug } from '../../lib/api'
import { LeaderboardView } from '../../components/LeaderboardView'
import type { EmpEvent } from '../../lib/types'

// Anonymous, shareable leaderboard page — works for events with
// public_leaderboard enabled (great for projecting at the venue).
export function PublicLeaderboardPage() {
  const { slug } = useParams<{ slug: string }>()
  const [event, setEvent] = useState<EmpEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    getEventBySlug(slug)
      .then((ev) => {
        if (!ev) setError('Event not found or its leaderboard is not public.')
        else setEvent(ev)
      })
      .catch((e: Error) => setError(e.message))
  }, [slug])

  if (error) return <div className="public-lb"><p className="form-error">{error}</p></div>
  if (!event) return <div className="public-lb"><p className="muted">Loading…</p></div>

  return (
    <div className="public-lb" style={{ ['--theme' as string]: event.theme_color }}>
      <header className="public-lb-head">
        {event.logo_url && <img src={event.logo_url} alt="" className="event-logo" />}
        <h1>{event.name}</h1>
        <p className="muted">Live leaderboard</p>
      </header>
      <LeaderboardView event={event} />
    </div>
  )
}
