import type {
  EmpEvent, EventCapabilities, LeaderboardConfig, LeaderboardEntity,
} from './types'

// Resolves 'auto' the same way the SQL does (00013): from participation
// availability — solo-only ranks individuals, team-only ranks teams, mixed
// events rank both together.
export function resolveEntity(
  entity: LeaderboardEntity,
  caps: EventCapabilities,
): Exclude<LeaderboardEntity, 'auto'> {
  if (entity !== 'auto') return entity
  if (caps.solo && caps.teams) return 'combined'
  if (caps.teams) return 'teams'
  return 'individuals'
}

// jsonb from the DB is untyped; '{}' (or a missing column on a pre-00013 row)
// means legacy defaults: enabled follows the points capability, entity is
// derived from participation, visibility maps from public_leaderboard.
export function normalizeLeaderboardConfig(
  raw: unknown,
  caps: EventCapabilities,
  publicLeaderboard: boolean,
): LeaderboardConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const entity = src.entity
  const metric = src.metric
  const visibility = src.visibility
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : caps.points,
    entity: entity === 'individuals' || entity === 'teams' || entity === 'combined' ? entity : 'auto',
    metric: metric === 'tasks' ? 'tasks' : 'balance',
    visibility: visibility === 'public' || visibility === 'hidden' || visibility === 'participants'
      ? visibility
      : publicLeaderboard ? 'public' : 'participants',
    show_member_count: src.show_member_count !== false,
  }
}

// Labels driven by event configuration, never hardcoded to a game vocabulary.
export function entityLabel(entity: Exclude<LeaderboardEntity, 'auto'>): string {
  if (entity === 'teams') return 'Team'
  if (entity === 'individuals') return 'Participant'
  return 'Participant / Team'
}

export function metricLabel(event: EmpEvent): string {
  return event.leaderboard_config.metric === 'tasks' ? 'Tasks' : event.currency_name_plural
}
