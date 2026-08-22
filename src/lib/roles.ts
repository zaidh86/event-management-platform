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

// THE frontend club-authority predicate — the mirror of is_club_admin() in SQL
// (00021 §1b), which is itself the single chokepoint every club and event
// policy calls. Both lists must stay identical: convener is a teacher who RUNS
// the club and holds exactly what club_admin holds; faculty is a teacher merely
// ASSOCIATED with it and holds nothing, so it is absent here on purpose.
//
// This is a UI convenience only. Every one of these decisions is enforced again
// in the database, so a stale or bypassed check here changes what is drawn, not
// what is permitted.
const CLUB_AUTHORITY_ROLES: ClubRole[] = ['club_admin', 'convener']

export function isClubAuthority(role: ClubRole | null | undefined): boolean {
  return role != null && CLUB_AUTHORITY_ROLES.includes(role)
}

// Faculty and Convener are both teachers; the badge says so, and the label
// distinguishes which of them carries authority.
export function isFacultyRole(role: ClubRole | null | undefined): boolean {
  return role === 'faculty' || role === 'convener'
}

export function clubRoleLabel(role: ClubRole | null | undefined): string | null {
  if (role === 'club_admin') return 'Club Admin'
  if (role === 'convener') return 'Convener'
  if (role === 'faculty') return 'Faculty'
  return null
}

// Management surfaces (rosters, role pickers) do need a word for every role,
// including the ordinary one — there the label is the control, not decoration.
// Typed as Record<ClubRole, string> so adding a role to the union without
// giving it a label is a COMPILE ERROR rather than a blank <option>.
const CLUB_ROLE_LABELS: Record<ClubRole, string> = {
  club_admin: 'Club Admin',
  convener: 'Convener',
  faculty: 'Faculty',
  member: 'Member',
}

// Ordered by authority, then association: the two roles that can manage the
// club first, then the teacher with no authority, then ordinary standing.
export const CLUB_ROLE_OPTIONS: { value: ClubRole; label: string; hint: string }[] = [
  { value: 'club_admin', label: CLUB_ROLE_LABELS.club_admin, hint: 'Full club authority' },
  { value: 'convener', label: CLUB_ROLE_LABELS.convener, hint: 'Teacher — full club authority' },
  { value: 'faculty', label: CLUB_ROLE_LABELS.faculty, hint: 'Teacher — no club authority' },
  { value: 'member', label: CLUB_ROLE_LABELS.member, hint: 'No club authority' },
]

export function clubRoleName(role: ClubRole): string {
  return CLUB_ROLE_LABELS[role] ?? role
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
