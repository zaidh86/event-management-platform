import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { getLeaderboard } from '../lib/api'
import { supabase } from '../lib/supabase'
import { fmtPoints } from '../lib/format'
import { entityLabel, metricLabel, resolveEntity } from '../lib/leaderboard'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import type { EmpEvent, LeaderboardRow } from '../lib/types'

// Universal live leaderboard: what is ranked, by which metric, and how it is
// labeled all come from the event's leaderboard configuration (ADR-0008) —
// never from assuming a team/gamified event. Standings refetch whenever any
// account balance in the event changes (Supabase Realtime).
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

  const cfg = event.leaderboard_config
  const entity = resolveEntity(cfg.entity, event.capabilities)

  if (error) return <p className="form-error">{error}</p>
  if (!rows) return <Skeleton lines={4} height="2.6rem" />
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title={
          entity === 'teams'
            ? 'No teams on the leaderboard yet'
            : entity === 'individuals'
              ? 'No participants on the leaderboard yet'
              : 'No participants or teams on the leaderboard yet'
        }
        hint={
          entity === 'teams'
            ? 'Teams appear here once participants create or join them.'
            : 'Entries appear here as participants register and take part.'
        }
      />
    )
  }

  return (
    <div>
      <div className="lb-head" aria-hidden>
        <span className="lb-rank">#</span>
        <span>{entityLabel(entity)}</span>
        <span>{metricLabel(event)}</span>
      </div>
      <ol className="leaderboard">
        {rows.map((row) => (
          <li key={row.account_id} className={`lb-row ${row.rank <= 3 ? `lb-top lb-${row.rank}` : ''}`}>
            <span className="lb-rank">{row.rank}</span>
            <span className="lb-name">
              {row.name}
              {row.owner_type === 'team' && cfg.show_member_count && (
                <span className="muted lb-members"> · {row.member_count} member{row.member_count === 1 ? '' : 's'}</span>
              )}
            </span>
            <span className="lb-balance">
              {cfg.metric === 'tasks' ? (
                <>{row.tasks_completed ?? 0} task{(row.tasks_completed ?? 0) === 1 ? '' : 's'}</>
              ) : (
                <>
                  <img src={event.currency_image_url ?? '/currency-default.svg'} alt="" className="currency-img" />
                  {fmtPoints(event, row.balance)}
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
