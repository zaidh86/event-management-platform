import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import { getEventBySlug, getLeaderboard } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { fmtPoints } from '../../lib/format'
import { entityLabel, metricLabel, resolveEntity } from '../../lib/leaderboard'
import type { EmpEvent, LeaderboardRow } from '../../lib/types'

// Projector mode (/e/:slug/projector): a venue display for the event.
// It CONSUMES the universal leaderboard (00013) — same entity/metric/visibility
// configuration, same realtime channel — fixed to the top 10, with prominent
// event identity and a public-safe highlights ticker (names + scores only;
// access itself is enforced server-side by events RLS + get_leaderboard).
const TOP_N = 10

export function ProjectorPage() {
  const { slug } = useParams<{ slug: string }>()
  const [event, setEvent] = useState<EmpEvent | null>(null)
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!slug) return
    getEventBySlug(slug)
      .then((ev) => {
        if (!ev) setError('This display is not available.')
        else setEvent(ev)
      })
      .catch(() => setError('This display is not available.'))
  }, [slug])

  useEffect(() => {
    if (!event) return
    let alive = true
    const load = () => {
      getLeaderboard(event.id)
        .then((r) => { if (alive) { setRows(r); setError(null) } })
        .catch(() => { if (alive) setError('This display is not available.') })
    }
    load()
    const channel = supabase
      .channel(`projector-${event.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accounts', filter: `event_id=eq.${event.id}` },
        load,
      )
      .subscribe()
    return () => {
      alive = false
      void supabase.removeChannel(channel)
    }
  }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // highlights ticker rotates through the current top entries
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 6000)
    return () => clearInterval(t)
  }, [])

  const top = useMemo(() => (rows ?? []).slice(0, TOP_N), [rows])
  const highlight = top.length > 0 ? top[tick % Math.min(top.length, 3)] : null

  if (error) {
    return (
      <div className="projector projector-message">
        <h1>EMP</h1>
        <p>{error}</p>
      </div>
    )
  }
  if (!event || rows === null) {
    return <div className="projector projector-message"><p>Loading…</p></div>
  }

  const entity = resolveEntity(event.leaderboard_config.entity, event.capabilities)
  const metric = event.leaderboard_config.metric

  return (
    <div className="projector" style={{ ['--theme' as string]: event.theme_color }}>
      <header className="projector-head">
        {event.logo_url && <img src={event.logo_url} alt="" className="projector-logo" />}
        <div>
          <h1>{event.name}</h1>
          <p className="projector-sub">
            Top {Math.min(TOP_N, Math.max(top.length, 1))} · {entityLabel(entity)}s · {metricLabel(event)}
          </p>
        </div>
        <Trophy className="projector-trophy" aria-hidden />
      </header>

      {top.length === 0 ? (
        <p className="projector-empty">Standings appear here as the event gets going.</p>
      ) : (
        <ol className="projector-board">
          {top.map((row) => (
            <li key={row.account_id} className={`projector-row ${row.rank <= 3 ? `projector-top-${row.rank}` : ''}`}>
              <span className="projector-rank">{row.rank}</span>
              <span className="projector-name">
                {row.name}
                {row.owner_type === 'team' && event.leaderboard_config.show_member_count && (
                  <span className="projector-members"> · {row.member_count}</span>
                )}
              </span>
              <span className="projector-score">
                {metric === 'tasks'
                  ? `${row.tasks_completed ?? 0}`
                  : fmtPoints(event, row.balance)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {highlight && (
        <footer className="projector-ticker" aria-hidden>
          <span>
            🏆 #{highlight.rank} {highlight.name} — {metric === 'tasks'
              ? `${highlight.tasks_completed ?? 0} ${metricLabel(event).toLowerCase()}`
              : fmtPoints(event, highlight.balance)}
          </span>
        </footer>
      )}
    </div>
  )
}
