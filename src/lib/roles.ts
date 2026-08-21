import type { ClubRole, EventRole, GlobalRole } from './types'

// Roles are surfaced only where they tell someone what they can do. Ordinary
// standing — 'user', club 'member', event 'participant' — grants nothing extra,
// so it gets no badge: the database has a role column, the interface does not
// have to repeat it.

export function platformRoleLabel(role: GlobalRole | null | undefined): string | null {
  if (role === 'platform_owner') return 'Platform Owner'
  if (role === 'super_admin') return 'Super Admin'
  return null
}

export function clubRoleLabel(role: ClubRole | null | undefined): string | null {
  return role === 'club_admin' ? 'Club Admin' : null
}

// Management surfaces (rosters, role pickers) do need a word for every role,
// including the ordinary one — there the label is the control, not decoration.
export const CLUB_ROLE_OPTIONS: { value: ClubRole; label: string }[] = [
  { value: 'club_admin', label: 'Club Admin' },
  { value: 'member', label: 'Member' },
]

export function clubRoleName(role: ClubRole): string {
  return CLUB_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role
}

export function eventRoleLabel(role: EventRole | null | undefined): string | null {
  switch (role) {
    case 'organizer':
      return 'Organizer'
    case 'activity_admin':
      return 'Activity Admin'
    case 'volunteer':
      return 'Volunteer'
    case 'judge':
      return 'Judge'
    default:
      return null
  }
}
