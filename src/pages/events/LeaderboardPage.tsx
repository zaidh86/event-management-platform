import { LeaderboardView } from '../../components/LeaderboardView'
import { useEvent } from './EventLayout'

export function LeaderboardPage() {
  const { event } = useEvent()
  return (
    <div className="page">
      <div className="page-head">
        <h2>Leaderboard</h2>
        {event.public_leaderboard && (
          <a href={`/e/${event.slug}/leaderboard`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            Public link ↗
          </a>
        )}
      </div>
      <LeaderboardView event={event} />
    </div>
  )
}
