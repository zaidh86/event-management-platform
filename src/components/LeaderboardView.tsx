import { useEffect, useState } from 'react'
import { getLeaderboard } from '../lib/api'
import { supabase } from '../lib/supabase'
import { fmtPoints } from '../lib/format'
import type { EmpEvent, LeaderboardRow } from '../lib/types'

// Live leaderboard: fetches standings and refetches whenever any account
// balance in the event changes (Supabase Realtime, filtered by event).
export function LeaderboardView({ event }: { event: EmpEvent }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      getLeaderboard(event.id)
        .then((r) => {
          if (alive) {
            setRows(r)
            setError(null)
          }
        })
        .catch((e: Error) => {
          if (alive) setError(e.message)
        })
    }
    load()
    const channel = supabase
      .channel(`leaderboard-${event.id}`)
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
  }, [event.id])

  if (error) return <p className="form-error">{error}</p>
  if (!rows) return <p className="muted">Loading standings…</p>
  if (rows.length === 0) return <p className="muted">No {event.is_team_event ? 'teams' : 'participants'} yet.</p>

  return (
    <ol className="leaderboard">
      {rows.map((row) => (
        <li key={row.account_id} className={`lb-row ${row.rank <= 3 ? `lb-top lb-${row.rank}` : ''}`}>
          <span className="lb-rank">{row.rank}</span>
          <span className="lb-name">
            {row.name}
            {row.owner_type === 'team' && (
              <span className="muted lb-members"> · {row.member_count} member{row.member_count === 1 ? '' : 's'}</span>
            )}
          </span>
          <span className="lb-balance">
            <img src={event.currency_image_url ?? '/currency-default.svg'} alt="" className="currency-img" />
            {fmtPoints(event, row.balance)}
          </span>
        </li>
      ))}
    </ol>
  )
}
