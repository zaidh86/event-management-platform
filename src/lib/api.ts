// Typed data-access helpers. Pages call these instead of building queries inline.
import { supabase } from './supabase'
import { normalizeCapabilities } from './capabilities'
import type {
  Activity, Announcement, Club, ClubMember, ClubRole, EmpEvent, EventMember,
  LeaderboardRow, Participant, Profile, QrResolution, Team, Transaction, TransactionType,
} from './types'

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

// Rows created before migrations 00005/00006 lack club_id/capabilities;
// normalize at the boundary so EmpEvent is always fully populated.
function toEvent(row: Record<string, unknown>): EmpEvent {
  return {
    ...(row as unknown as EmpEvent),
    club_id: (row.club_id as string | undefined) ?? null,
    capabilities: normalizeCapabilities(row.capabilities, row.is_team_event === true),
  }
}

// ---- events ----------------------------------------------------------------

export async function listMyEvents(): Promise<EmpEvent[]> {
  const { data, error } = await supabase
    .from('events').select('*').order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []).map(toEvent)
}

export async function getEvent(id: string): Promise<EmpEvent | null> {
  const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle()
  throwIf(error)
  return data ? toEvent(data) : null
}

export async function getEventBySlug(slug: string): Promise<EmpEvent | null> {
  const { data, error } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle()
  throwIf(error)
  return data ? toEvent(data) : null
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    || `event-${Math.random().toString(36).slice(2, 8)}`
}

export async function createEvent(fields: Partial<EmpEvent> & { name: string }): Promise<EmpEvent> {
  const { data, error } = await supabase
    .from('events')
    .insert({ slug: slugify(fields.name), ...fields })
    .select().single()
  throwIf(error)
  return toEvent(data as Record<string, unknown>)
}

export async function updateEvent(id: string, fields: Partial<EmpEvent>): Promise<EmpEvent> {
  const { data, error } = await supabase
    .from('events').update(fields).eq('id', id).select().single()
  throwIf(error)
  return toEvent(data as Record<string, unknown>)
}

// ---- clubs -----------------------------------------------------------------

export async function listClubs(): Promise<Club[]> {
  const { data, error } = await supabase.from('clubs').select('*').order('name')
  throwIf(error)
  return (data ?? []) as Club[]
}

export async function getClub(id: string): Promise<Club | null> {
  const { data, error } = await supabase.from('clubs').select('*').eq('id', id).maybeSingle()
  throwIf(error)
  return data as Club | null
}

export async function getClubBySlug(slug: string): Promise<Club | null> {
  const { data, error } = await supabase.from('clubs').select('*').eq('slug', slug).maybeSingle()
  throwIf(error)
  return data as Club | null
}

export async function listMyClubMemberships(userId: string): Promise<ClubMember[]> {
  const { data, error } = await supabase
    .from('club_members').select('*').eq('user_id', userId)
  throwIf(error)
  return (data ?? []) as ClubMember[]
}

export async function listClubMembers(clubId: string): Promise<(ClubMember & { profile: Profile })[]> {
  const { data, error } = await supabase
    .from('club_members')
    .select('*, profile:profiles(*)')
    .eq('club_id', clubId)
    .order('created_at')
  throwIf(error)
  return (data ?? []) as (ClubMember & { profile: Profile })[]
}

export async function createClub(fields: Partial<Club> & { name: string }): Promise<Club> {
  const { data, error } = await supabase
    .from('clubs')
    .insert({ slug: slugify(fields.name), ...fields })
    .select().single()
  throwIf(error)
  return data as Club
}

export async function updateClub(id: string, fields: Partial<Club>): Promise<Club> {
  const { data, error } = await supabase
    .from('clubs').update(fields).eq('id', id).select().single()
  throwIf(error)
  return data as Club
}

export async function addClubMemberByEmail(clubId: string, email: string, role: ClubRole): Promise<void> {
  const { data: profile, error: pErr } = await supabase
    .from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
  throwIf(pErr)
  if (!profile) throw new Error(`No account found for ${email}. They must sign up first.`)
  const { error } = await supabase
    .from('club_members').insert({ club_id: clubId, user_id: profile.id, role })
  throwIf(error)
}

export async function updateClubMemberRole(memberId: string, role: ClubRole): Promise<void> {
  const { error } = await supabase.from('club_members').update({ role }).eq('id', memberId)
  throwIf(error)
}

export async function removeClubMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('club_members').delete().eq('id', memberId)
  throwIf(error)
}

export async function listClubEvents(clubId: string): Promise<EmpEvent[]> {
  const { data, error } = await supabase
    .from('events').select('*').eq('club_id', clubId)
    .order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []).map(toEvent)
}

// ---- membership / roles ----------------------------------------------------

export async function getMyMembership(eventId: string, userId: string): Promise<EventMember | null> {
  const { data, error } = await supabase
    .from('event_members').select('*')
    .eq('event_id', eventId).eq('user_id', userId).maybeSingle()
  throwIf(error)
  return data as EventMember | null
}

export async function listMembers(eventId: string): Promise<(EventMember & { profile: Profile })[]> {
  const { data, error } = await supabase
    .from('event_members')
    .select('*, profile:profiles(*)')
    .eq('event_id', eventId)
    .order('created_at')
  throwIf(error)
  return (data ?? []) as (EventMember & { profile: Profile })[]
}

export async function addMemberByEmail(eventId: string, email: string, role: string): Promise<void> {
  const { data: profile, error: pErr } = await supabase
    .from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
  throwIf(pErr)
  if (!profile) throw new Error(`No account found for ${email}. They must sign up first.`)
  const { error } = await supabase
    .from('event_members').insert({ event_id: eventId, user_id: profile.id, role })
  throwIf(error)
}

export async function updateMemberRole(memberId: string, role: string): Promise<void> {
  const { error } = await supabase.from('event_members').update({ role }).eq('id', memberId)
  throwIf(error)
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('event_members').delete().eq('id', memberId)
  throwIf(error)
}

// ---- registration / participants / teams -----------------------------------

export async function registerForEvent(
  eventId: string, displayName: string, registrationData: Record<string, unknown>,
): Promise<Participant> {
  const { data, error } = await supabase.rpc('register_for_event', {
    p_event_id: eventId, p_display_name: displayName, p_registration_data: registrationData,
  })
  throwIf(error)
  return data as Participant
}

export async function getMyParticipant(eventId: string, userId: string): Promise<Participant | null> {
  const { data, error } = await supabase
    .from('participants').select('*')
    .eq('event_id', eventId).eq('user_id', userId).maybeSingle()
  throwIf(error)
  return data as Participant | null
}

export async function listParticipants(eventId: string): Promise<Participant[]> {
  const { data, error } = await supabase
    .from('participants').select('*').eq('event_id', eventId).order('created_at')
  throwIf(error)
  return (data ?? []) as Participant[]
}

export async function createTeam(eventId: string, name: string): Promise<Team> {
  const { data, error } = await supabase.rpc('create_team', { p_event_id: eventId, p_name: name })
  throwIf(error)
  return data as Team
}

export async function joinTeam(teamId: string): Promise<Team> {
  const { data, error } = await supabase.rpc('join_team', { p_team_id: teamId })
  throwIf(error)
  return data as Team
}

export async function listTeams(eventId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams').select('*').eq('event_id', eventId).order('name')
  throwIf(error)
  return (data ?? []) as Team[]
}

export async function getTeam(teamId: string): Promise<Team | null> {
  const { data, error } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle()
  throwIf(error)
  return data as Team | null
}

export async function listTeamMembers(teamId: string): Promise<Participant[]> {
  const { data, error } = await supabase
    .from('participants').select('*').eq('team_id', teamId).order('created_at')
  throwIf(error)
  return (data ?? []) as Participant[]
}

// ---- accounts / transactions ----------------------------------------------

export async function getAccountFor(ownerType: string, ownerId: string) {
  const { data, error } = await supabase
    .from('accounts').select('*')
    .eq('owner_type', ownerType).eq('owner_id', ownerId).maybeSingle()
  throwIf(error)
  return data
}

export async function listAccountTransactions(accountId: string, limit = 50): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions').select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false }).limit(limit)
  throwIf(error)
  return (data ?? []) as Transaction[]
}

export async function listEventTransactions(eventId: string, limit = 100): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions').select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false }).limit(limit)
  throwIf(error)
  return (data ?? []) as Transaction[]
}

export async function processTransaction(input: {
  accountId: string
  amount: number
  type: TransactionType
  activityId?: string | null
  description?: string
  metadata?: Record<string, unknown>
}): Promise<Transaction> {
  const { data, error } = await supabase.rpc('process_transaction', {
    p_account_id: input.accountId,
    p_amount: input.amount,
    p_type: input.type,
    p_activity_id: input.activityId ?? null,
    p_description: input.description ?? '',
    p_metadata: input.metadata ?? {},
  })
  throwIf(error)
  return data as Transaction
}

export async function resolveQr(qrToken: string): Promise<QrResolution> {
  const { data, error } = await supabase.rpc('resolve_qr', { p_qr_token: qrToken })
  throwIf(error)
  return data as QrResolution
}

// ---- leaderboard -----------------------------------------------------------

export async function getLeaderboard(eventId: string): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_event_id: eventId })
  throwIf(error)
  return (data ?? []) as LeaderboardRow[]
}

// ---- activities ------------------------------------------------------------

export async function listActivities(eventId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities').select('*').eq('event_id', eventId).order('created_at')
  throwIf(error)
  return (data ?? []) as Activity[]
}

export async function createActivity(fields: Partial<Activity> & {
  event_id: string; name: string; kind: string
}): Promise<Activity> {
  const { data, error } = await supabase.from('activities').insert(fields).select().single()
  throwIf(error)
  return data as Activity
}

export async function updateActivity(id: string, fields: Partial<Activity>): Promise<Activity> {
  const { data, error } = await supabase
    .from('activities').update(fields).eq('id', id).select().single()
  throwIf(error)
  return data as Activity
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase.from('activities').delete().eq('id', id)
  throwIf(error)
}

// Generates an API key for an integrated activity. The plaintext is returned
// exactly once; only its SHA-256 hash is stored on the activity row.
export async function issueActivityApiKey(activityId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const key = 'emp_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  const { error } = await supabase.from('activities').update({ api_key_hash: hash }).eq('id', activityId)
  throwIf(error)
  return key
}

// ---- announcements ---------------------------------------------------------

export async function listAnnouncements(eventId: string): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements').select('*')
    .eq('event_id', eventId).order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []) as Announcement[]
}

export async function postAnnouncement(eventId: string, title: string, body: string): Promise<void> {
  const { error } = await supabase.from('announcements').insert({ event_id: eventId, title, body })
  throwIf(error)
}

// ---- storage ---------------------------------------------------------------

export async function uploadEventMedia(eventId: string, file: File, kind: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'png'
  const path = `${eventId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('event-media').upload(path, file, { upsert: true })
  throwIf(error)
  return supabase.storage.from('event-media').getPublicUrl(path).data.publicUrl
}
