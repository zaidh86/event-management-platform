import { useEffect, useState, type FormEvent } from 'react'
import { listAnnouncements, postAnnouncement } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/format'
import { useEvent } from './EventLayout'
import type { Announcement } from '../../lib/types'

export function OverviewPage() {
  const { event, isOrganizer, role } = useEvent()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!role && !isOrganizer) return // non-members can't read announcements
    listAnnouncements(event.id).then(setAnnouncements).catch(() => {})
    const channel = supabase
      .channel(`announcements-${event.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'announcements', filter: `event_id=eq.${event.id}` },
        (payload) => setAnnouncements((prev) => [payload.new as Announcement, ...prev]),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [event.id, role, isOrganizer])

  async function onPost(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await postAnnouncement(event.id, title, body)
      setTitle('')
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post')
    }
  }

  return (
    <div className="page">
      {event.banner_url && <img src={event.banner_url} alt="" className="event-banner" />}
      <p className="event-description">{event.description}</p>
      <div className="overview-grid">
        <section className="card">
          <h2>Event info</h2>
          <dl className="info-list">
            <dt>Format</dt>
            <dd>{event.is_team_event ? `Teams of ${event.team_size_min}–${event.team_size_max}` : 'Individual'}</dd>
            <dt>Currency</dt>
            <dd className="currency-cell">
              <img
                src={event.currency_image_url ?? '/currency-default.svg'}
                alt="" className="currency-img"
              />
              {event.currency_name} / {event.currency_name_plural}
            </dd>
            <dt>Starting balance</dt>
            <dd>{event.starting_balance.toLocaleString()}</dd>
            <dt>Leaderboard</dt>
            <dd>{event.public_leaderboard ? 'Public' : 'Members only'}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Announcements</h2>
          {isOrganizer && (
            <form onSubmit={(e) => void onPost(e)} className="stack announce-form">
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <textarea placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
              {error && <p className="form-error">{error}</p>}
              <button className="btn btn-primary btn-sm">Post announcement</button>
            </form>
          )}
          {announcements.length === 0 && <p className="muted">No announcements yet.</p>}
          <ul className="announce-list">
            {announcements.map((a) => (
              <li key={a.id}>
                <div className="announce-head">
                  <strong>{a.title}</strong>
                  <span className="muted">{fmtDateTime(a.created_at)}</span>
                </div>
                {a.body && <p>{a.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
