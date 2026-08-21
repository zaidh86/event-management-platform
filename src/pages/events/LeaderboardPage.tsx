import { LeaderboardView } from '../../components/LeaderboardView'
import { useEvent } from './EventLayout'

export function LeaderboardPage() {
  const { event, isStaff } = useEvent()
  return (
    <div className="page">
      <div className="page-head">
        <h2>Leaderboard</h2>
        <div className="row">
          {event.public_leaderboard && (
            <a href={`/e/${event.slug}/leaderboard`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              Public link ↗
            </a>
          )}
          {isStaff && event.leaderboard_config.enabled && (
            <a href={`/e/${event.slug}/projector`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              Projector view ↗
            </a>
          )}
        </div>
      </div>
      <LeaderboardView event={event} />
    </div>
  )
}
