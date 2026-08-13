import type { EventCapabilities } from './types'

// Mirrors the DB default in supabase/migrations/00006_event_capabilities.sql.
export const LEGACY_CAPABILITIES: EventCapabilities = {
  teams: true,
  points: true,
  qr: true,
  attendance: false,
  submissions: false,
  judging: false,
  deadlines: false,
  feedback: false,
  certificates: false,
  games_api: true,
}

// jsonb from the DB is untyped; absent keys mean false, an absent column means
// a pre-00006 row and gets the legacy set (teams following is_team_event).
export function normalizeCapabilities(raw: unknown, isTeamEvent: boolean): EventCapabilities {
  if (raw == null || typeof raw !== 'object') {
    return { ...LEGACY_CAPABILITIES, teams: isTeamEvent }
  }
  const src = raw as Record<string, unknown>
  const get = (key: keyof EventCapabilities) => src[key] === true
  return {
    teams: get('teams'),
    points: get('points'),
    qr: get('qr'),
    attendance: get('attendance'),
    submissions: get('submissions'),
    judging: get('judging') && get('submissions'), // judging requires submissions
    deadlines: get('deadlines'),
    feedback: get('feedback'),
    certificates: get('certificates'),
    games_api: get('games_api'),
  }
}
