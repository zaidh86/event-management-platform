// Typed data-access helpers. Pages call these instead of building queries inline.
import { supabase } from './supabase'
import { normalizeCapabilities } from './capabilities'
import { normalizeLeaderboardConfig } from './leaderboard'
import { normalizeSubmissionConfig } from './submissions'
import { normalizeTableConfig } from './tables'
import type {
  Activity, AiFeedbackAnalysis, Announcement, AttendanceRecord, Club, ClubMember, ClubRole, EmpEvent,
  EventReportAnalysis, EventReportAnalysisCriterion,
  EventMember, EventTable, FeedbackForm, FeedbackResponse, JudgeEvaluation, JudgingCriterion,
  JudgingResult, LeaderboardRow, Participant, ParticipantRemovalResult,
  ParticipationMode, Profile,
  PublicQrResolution, QrAction, QrConfig, QrResolution, ScanOutcome, ScanRecord,
  JoinableTeam, Submission, Team, TeamJoinRequest, Transaction, TransactionType, VerifiedCertificate,
} from './types'
import type { Certificate, CertificateKind } from './types'

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

// Rows created before migrations 00005/00006 lack club_id/capabilities;
// normalize at the boundary so EmpEvent is always fully populated.
function toEvent(row: Record<string, unknown>): EmpEvent {
  const capabilities = normalizeCapabilities(row.capabilities, row.is_team_event === true)
  return {
    ...(row as unknown as EmpEvent),
    club_id: (row.club_id as string | undefined) ?? null,
    capabilities,
    leaderboard_config: normalizeLeaderboardConfig(
      row.leaderboard_config, capabilities, row.public_leaderboard === true,
    ),
    // rows from a live DB that predates 00015 lack the column
    is_featured: row.is_featured === true,
    submission_config: normalizeSubmissionConfig(row.submission_config),
    table_config: normalizeTableConfig(row.table_config),
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

// Permanent. Every row referencing the event cascades away with it
// (participants, teams, accounts, transactions, activities, announcements).
// An RLS-blocked delete returns success with zero rows rather than an error,
// so the returned row is what proves the delete actually happened.
export async function deleteEvent(id: string): Promise<void> {
  const { data, error } = await supabase.from('events').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Event was not deleted — you do not have permission to delete this event.')
  }
}

// featured events for the Home page: explicit platform curation (ADR-0010)
export async function listFeaturedEvents(): Promise<EmpEvent[]> {
  const { data, error } = await supabase
    .from('events').select('*')
    .eq('is_featured', true)
    .in('status', ['active', 'ended'])
    .order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []).map(toEvent)
}

// platform admins only — the protect_event_featured trigger is the enforcement;
// the returned row proves the write happened (RLS no-ops return zero rows)
export async function setEventFeatured(id: string, featured: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('events').update({ is_featured: featured }).eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Not permitted — only platform administrators can feature events.')
  }
}

// ---- profiles / platform administration -------------------------------------

export async function updateMyProfile(userId: string, fullName: string): Promise<void> {
  const { data, error } = await supabase
    .from('profiles').update({ full_name: fullName.trim() }).eq('id', userId).select('id')
  throwIf(error)
  if (!data || data.length === 0) throw new Error('Profile was not updated.')
}

export async function listPlatformAdmins(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles').select('*')
    .in('role', ['platform_owner', 'super_admin'])
    .order('role', { ascending: false }).order('created_at')
  throwIf(error)
  return (data ?? []) as Profile[]
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await supabase
    .from('profiles').select('*')
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order('email').limit(10)
  throwIf(error)
  return (data ?? []) as Profile[]
}

// grant/revoke super admin. The protect_profile_role trigger is the real
// authorization (super admins only; the owner row is untouchable).
export async function setGlobalRole(userId: string, role: 'user' | 'super_admin'): Promise<void> {
  const { data, error } = await supabase
    .from('profiles').update({ role }).eq('id', userId).select('id')
  throwIf(error)
  if (!data || data.length === 0) throw new Error('Role was not changed — not permitted.')
}

// atomic owner handover (00015): caller must BE the platform owner
export async function transferPlatformOwnership(newOwnerId: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_platform_ownership', {
    p_new_owner_id: newOwnerId,
  })
  throwIf(error)
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

// Permanent, and deliberately narrow: a club can only be deleted when it owns no
// events. events.club_id is NO ACTION, so the database rejects the delete with a
// foreign-key violation rather than cascading into event data. As with events, an
// RLS-blocked delete returns success with zero rows, so the returned row is what
// proves the delete actually happened.
export async function deleteClub(id: string): Promise<void> {
  const { data, error } = await supabase.from('clubs').delete().eq('id', id).select('id')
  if (error) {
    if (error.code === '23503' || /foreign key/i.test(error.message)) {
      throw new Error(
        'This club cannot be deleted while it contains events. Delete the events first.',
      )
    }
    throw new Error(error.message)
  }
  if (!data || data.length === 0) {
    throw new Error('Club was not deleted — you do not have permission to delete this club.')
  }
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
  const { data, error } = await supabase
    .from('club_members').delete().eq('id', memberId).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Member was not removed — you do not have permission.')
  }
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
  const { data, error } = await supabase
    .from('event_members').delete().eq('id', memberId).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Member was not removed — you do not have permission.')
  }
}

// ---- registration / participants / teams -----------------------------------

export async function registerForEvent(
  eventId: string, displayName: string, registrationData: Record<string, unknown>,
  participationMode: ParticipationMode,
): Promise<Participant> {
  const { data, error } = await supabase.rpc('register_for_event', {
    p_event_id: eventId, p_display_name: displayName, p_registration_data: registrationData,
    p_participation_mode: participationMode,
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

// Removes a registration from ONE event — never the user's account, their club
// membership, or their registrations elsewhere. Authorization, the refusal
// rules and the cleanup all live in the RPC (00021 §2b); this is a thin call.
//
// A 'blocked' result is a normal outcome, not a thrown error: the caller shows
// the reasons and, when override_allowed, re-calls with force plus a reason.
export async function removeEventParticipant(
  participantId: string, reason = '', force = false,
): Promise<ParticipantRemovalResult> {
  const { data, error } = await supabase.rpc('remove_event_participant', {
    p_participant_id: participantId, p_reason: reason, p_force: force,
  })
  throwIf(error)
  return data as ParticipantRemovalResult
}

export async function createTeam(eventId: string, name: string): Promise<Team> {
  const { data, error } = await supabase.rpc('create_team', { p_event_id: eventId, p_name: name })
  throwIf(error)
  return data as Team
}

// ---- team join requests (00023) -------------------------------------------------
// Joining is by approval: the participant requests, the team's creator (or an
// Event Manager) accepts/declines. Eligibility and capacity are re-checked
// server-side at the moment of acceptance; join_team() is no longer callable
// by clients.

// RLS scopes rows: the requester sees their own, a team creator sees requests
// to their team, Event Managers see all
export async function listTeamJoinRequests(eventId: string): Promise<TeamJoinRequest[]> {
  const { data, error } = await supabase
    .from('team_join_requests').select('*').eq('event_id', eventId)
    .order('created_at')
  throwIf(error)
  return (data ?? []) as TeamJoinRequest[]
}

export async function requestTeamJoin(teamId: string): Promise<TeamJoinRequest> {
  const { data, error } = await supabase.rpc('request_team_join', { p_team_id: teamId })
  throwIf(error)
  return data as TeamJoinRequest
}

export async function respondTeamJoinRequest(requestId: string, accept: boolean): Promise<TeamJoinRequest> {
  const { data, error } = await supabase.rpc('respond_team_join_request', {
    p_request_id: requestId, p_accept: accept,
  })
  throwIf(error)
  return data as TeamJoinRequest
}

export async function withdrawTeamJoinRequest(requestId: string): Promise<TeamJoinRequest> {
  const { data, error } = await supabase.rpc('withdraw_team_join_request', { p_request_id: requestId })
  throwIf(error)
  return data as TeamJoinRequest
}

// the participant join picker (00024): only teams with at least one member
// and a free seat. Computed server-side because participants RLS hides other
// teams' members from a teamless participant. Organizer/admin surfaces keep
// using listTeams (every team, including emptied ones they may clean up).
export async function listJoinableTeams(eventId: string): Promise<JoinableTeam[]> {
  const { data, error } = await supabase.rpc('list_joinable_teams', { p_event_id: eventId })
  throwIf(error)
  return (data ?? []) as JoinableTeam[]
}

// every team of the event the caller may see (teams RLS) — organizer/admin
// listings, certificates, table allocation
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

// ---- universal QR operations (ADR-0009) -------------------------------------

export async function listQrConfigs(eventId: string): Promise<QrConfig[]> {
  const { data, error } = await supabase
    .from('qr_configs').select('*').eq('event_id', eventId)
    .order('sort_order').order('created_at')
  throwIf(error)
  return (data ?? []) as QrConfig[]
}

export async function createQrConfig(fields: Partial<QrConfig> & {
  event_id: string; label: string; target: string; actions: string[]
}): Promise<QrConfig> {
  const { data, error } = await supabase.from('qr_configs').insert(fields).select().single()
  throwIf(error)
  return data as QrConfig
}

export async function updateQrConfig(id: string, fields: Partial<QrConfig>): Promise<QrConfig> {
  const { data, error } = await supabase
    .from('qr_configs').update(fields).eq('id', id).select().single()
  throwIf(error)
  return data as QrConfig
}

// RLS-blocked deletes return zero rows, not an error — verify the row is gone
export async function deleteQrConfig(id: string): Promise<void> {
  const { data, error } = await supabase.from('qr_configs').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('QR operation was not deleted — you do not have permission.')
  }
}

// the universal station entry point: all validation/authorization is server-side
export async function performScan(
  qrConfigId: string, qrToken: string, action: QrAction, note = '',
): Promise<ScanOutcome> {
  const { data, error } = await supabase.rpc('perform_scan', {
    p_qr_config_id: qrConfigId, p_qr_token: qrToken.trim(), p_action: action, p_note: note,
  })
  throwIf(error)
  return data as ScanOutcome
}

// anon-safe resolution of event/feedback q_ tokens (poster QRs)
export async function resolvePublicQr(token: string): Promise<PublicQrResolution> {
  const { data, error } = await supabase.rpc('resolve_public_qr', { p_token: token.trim() })
  throwIf(error)
  return data as PublicQrResolution
}

// ---- attendance --------------------------------------------------------------

export async function getMyAttendance(
  eventId: string, participantId: string,
): Promise<AttendanceRecord | null> {
  const { data, error } = await supabase
    .from('attendance').select('*')
    .eq('event_id', eventId).eq('participant_id', participantId).maybeSingle()
  throwIf(error)
  return data as AttendanceRecord | null
}

export async function countAttendance(eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from('attendance').select('id', { count: 'exact', head: true }).eq('event_id', eventId)
  throwIf(error)
  return count ?? 0
}

// ---- feedback ------------------------------------------------------------------

export async function listFeedbackForms(eventId: string): Promise<FeedbackForm[]> {
  const { data, error } = await supabase
    .from('feedback_forms').select('*').eq('event_id', eventId)
    .order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []) as FeedbackForm[]
}

// public/participant fill page: RLS scopes visibility (anon sees only
// published public forms; members also see published participant forms)
export async function getFeedbackForm(formId: string): Promise<FeedbackForm | null> {
  const { data, error } = await supabase
    .from('feedback_forms').select('*').eq('id', formId).maybeSingle()
  throwIf(error)
  return data as FeedbackForm | null
}

export async function createFeedbackForm(fields: Partial<FeedbackForm> & {
  event_id: string; title: string
}): Promise<FeedbackForm> {
  const { data, error } = await supabase.from('feedback_forms').insert(fields).select().single()
  throwIf(error)
  return data as FeedbackForm
}

export async function updateFeedbackForm(id: string, fields: Partial<FeedbackForm>): Promise<FeedbackForm> {
  const { data, error } = await supabase
    .from('feedback_forms').update(fields).eq('id', id).select().single()
  throwIf(error)
  return data as FeedbackForm
}

export async function deleteFeedbackForm(id: string): Promise<void> {
  const { data, error } = await supabase.from('feedback_forms').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Feedback form was not deleted — you do not have permission.')
  }
}

// Generic feedback (00022): one configurable form, any number of responses per
// respondent — the form's own questions carry context ("which team?").
// Validation (publish state, access, required answers) and respondent
// categorization are server-side.
export async function submitFeedback(
  formId: string, answers: Record<string, unknown>,
): Promise<{ status: 'ok' | 'duplicate'; message?: string }> {
  const { data, error } = await supabase.rpc('submit_feedback', {
    p_form_id: formId, p_answers: answers,
  })
  throwIf(error)
  return data as { status: 'ok' | 'duplicate'; message?: string }
}

export async function countFeedbackResponses(formId: string): Promise<number> {
  const { count, error } = await supabase
    .from('feedback_responses').select('id', { count: 'exact', head: true }).eq('form_id', formId)
  throwIf(error)
  return count ?? 0
}

export async function listFeedbackResponses(formId: string): Promise<FeedbackResponse[]> {
  const { data, error } = await supabase
    .from('feedback_responses').select('*').eq('form_id', formId)
    .order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []) as FeedbackResponse[]
}

// ---- event tables (00022) ------------------------------------------------------

// RLS: every event member may read the allocation list
export async function listEventTables(eventId: string): Promise<EventTable[]> {
  const { data, error } = await supabase
    .from('event_tables').select('*').eq('event_id', eventId).order('table_number')
  throwIf(error)
  return (data ?? []) as EventTable[]
}

// the caller's own unit: their solo row, or their team's row
export async function getMyEventTable(
  eventId: string, participant: Participant,
): Promise<EventTable | null> {
  if (participant.participation_mode === 'team' && !participant.team_id) return null
  const q = supabase.from('event_tables').select('*').eq('event_id', eventId)
  const { data, error } = participant.participation_mode === 'team'
    ? await q.eq('team_id', participant.team_id!).maybeSingle()
    : await q.eq('participant_id', participant.id).maybeSingle()
  throwIf(error)
  return data as EventTable | null
}

// manager backfill: allocate tables to units registered before the feature
// was enabled (server-authorized; idempotent). Returns the number assigned.
export async function assignEventTables(eventId: string): Promise<number> {
  const { data, error } = await supabase.rpc('assign_event_tables', { p_event_id: eventId })
  throwIf(error)
  return Number(data ?? 0)
}

// managers only (RLS delete policy); a no-op for anyone else
export async function clearEventTables(eventId: string): Promise<void> {
  const { error } = await supabase.from('event_tables').delete().eq('event_id', eventId)
  throwIf(error)
}

// ---- submissions & judging (ADR-0011) ----------------------------------------

// the caller's own entry: RLS returns only rows they own (solo or via team)
export async function getMySubmission(
  eventId: string, participant: Participant,
): Promise<Submission | null> {
  const q = supabase.from('submissions').select('*').eq('event_id', eventId)
  const { data, error } = participant.participation_mode === 'team' && participant.team_id
    ? await q.eq('team_id', participant.team_id).maybeSingle()
    : await q.eq('participant_id', participant.id).maybeSingle()
  throwIf(error)
  return data as Submission | null
}

export async function listSubmissions(eventId: string): Promise<Submission[]> {
  const { data, error } = await supabase
    .from('submissions').select('*').eq('event_id', eventId)
    .order('submitted_at', { ascending: true })
  throwIf(error)
  return (data ?? []) as Submission[]
}

// server-enforced: capability, active event, deadline, ownership by mode.
// documentPath: undefined = keep the stored PDF reference, '' = clear it,
// canonical path = record it (validated server-side, 00020)
export async function saveSubmission(input: {
  eventId: string; title: string; description?: string
  content?: Record<string, unknown>; submit?: boolean
  documentPath?: string; documentName?: string
}): Promise<Submission> {
  const { data, error } = await supabase.rpc('save_submission', {
    p_event_id: input.eventId,
    p_title: input.title,
    p_description: input.description ?? '',
    p_content: input.content ?? {},
    p_submit: input.submit ?? false,
    p_document_path: input.documentPath ?? null,
    p_document_name: input.documentName ?? null,
  })
  throwIf(error)
  return data as Submission
}

// ---- submission documents (00020: private `submission-docs` bucket) ---------
// One PDF per submission at the canonical path {event}/{submission}.pdf —
// replacement is an upsert of the same object. The bucket enforces PDF-only
// and a 10 MB cap server-side; storage RLS mirrors submission visibility.

const SUBMISSION_DOC_MAX_BYTES = 10 * 1024 * 1024

export function submissionDocumentPath(eventId: string, submissionId: string): string {
  return `${eventId}/${submissionId}.pdf`
}

export async function uploadSubmissionDocument(
  eventId: string, submissionId: string, file: File,
): Promise<{ path: string; name: string }> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF files are accepted.')
  if (file.size > SUBMISSION_DOC_MAX_BYTES) {
    throw new Error('This PDF is too large — the limit is 10 MB.')
  }
  const path = submissionDocumentPath(eventId, submissionId)
  const { error } = await supabase.storage
    .from('submission-docs')
    .upload(path, file, { upsert: true, contentType: 'application/pdf' })
  throwIf(error)
  return { path, name: file.name }
}

// short-lived signed URL; storage RLS decides who may create it
export async function getSubmissionDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('submission-docs').createSignedUrl(path, 300)
  throwIf(error)
  if (!data?.signedUrl) throw new Error('Could not open the document.')
  return data.signedUrl
}

export async function removeSubmissionDocument(path: string): Promise<void> {
  const { error } = await supabase.storage.from('submission-docs').remove([path])
  throwIf(error)
}

export async function listCriteria(eventId: string): Promise<JudgingCriterion[]> {
  const { data, error } = await supabase
    .from('judging_criteria').select('*').eq('event_id', eventId)
    .order('sort_order').order('created_at')
  throwIf(error)
  return (data ?? []) as JudgingCriterion[]
}

export async function createCriterion(fields: Partial<JudgingCriterion> & {
  event_id: string; name: string
}): Promise<JudgingCriterion> {
  const { data, error } = await supabase.from('judging_criteria').insert(fields).select().single()
  throwIf(error)
  return data as JudgingCriterion
}

export async function updateCriterion(id: string, fields: Partial<JudgingCriterion>): Promise<JudgingCriterion> {
  const { data, error } = await supabase
    .from('judging_criteria').update(fields).eq('id', id).select().single()
  throwIf(error)
  return data as JudgingCriterion
}

export async function deleteCriterion(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('judging_criteria').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Criterion was not deleted — you do not have permission.')
  }
}

// a judge's own evaluations for the event (RLS scopes to judge_id = auth.uid())
export async function listMyEvaluations(eventId: string): Promise<JudgeEvaluation[]> {
  const { data, error } = await supabase
    .from('judge_evaluations').select('*').eq('event_id', eventId)
  throwIf(error)
  return (data ?? []) as JudgeEvaluation[]
}

// all evaluations of one submission — Event Managers only (RLS)
export async function listSubmissionEvaluations(submissionId: string): Promise<JudgeEvaluation[]> {
  const { data, error } = await supabase
    .from('judge_evaluations').select('*').eq('submission_id', submissionId)
  throwIf(error)
  return (data ?? []) as JudgeEvaluation[]
}

export async function saveEvaluation(input: {
  submissionId: string; scores: Record<string, number>; notes?: string; finalize?: boolean
}): Promise<JudgeEvaluation> {
  const { data, error } = await supabase.rpc('save_evaluation', {
    p_submission_id: input.submissionId,
    p_scores: input.scores,
    p_notes: input.notes ?? '',
    p_finalize: input.finalize ?? false,
  })
  throwIf(error)
  return data as JudgeEvaluation
}

// the stored AI suggestion row for one entry (RLS: judges/organizers of the
// event, 00022); null when no analysis has been generated yet
export async function getAiEvaluation(submissionId: string): Promise<JudgeEvaluation | null> {
  const { data, error } = await supabase
    .from('judge_evaluations').select('*')
    .eq('submission_id', submissionId).eq('source', 'ai').maybeSingle()
  throwIf(error)
  return data as JudgeEvaluation | null
}

// ---- AI service (ai-service Edge Function; ADR-0015) ---------------------------
// The provider key never reaches the browser: every call goes through the
// Edge Function, which authenticates the caller with their own JWT and
// re-checks authorization server-side. Errors surface as plain messages so
// the UI can fall back to manual judging / manual reading.

async function invokeAi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-service', { body })
  if (error) {
    // non-2xx responses are wrapped; surface the function's own message when present
    const ctx = (error as { context?: Response }).context
    let message = error.message || 'AI service unavailable'
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = await ctx.json() as { error?: string }
        if (payload?.error) message = payload.error
      } catch { /* not JSON */ }
    }
    throw new Error(message)
  }
  const payload = data as ({ error?: string } & T) | null
  if (!payload) throw new Error('AI service returned nothing')
  if (payload.error) throw new Error(payload.error)
  return payload
}

// analyze a submitted entry (description + PDF) against the event's criteria
// and store the suggestion as the entry's source='ai' evaluation row
export async function requestAiJudging(submissionId: string, force = false): Promise<JudgeEvaluation> {
  const res = await invokeAi<{ evaluation: JudgeEvaluation }>({
    task: 'suggest_scores', submission_id: submissionId, force,
  })
  return res.evaluation
}

// ---- Event Report AI Analysis (00025) ------------------------------------------
// Its criteria are a SEPARATE system from judging_criteria: club authority
// (super_admin / club_admin / convener) configures them on the Analytics page,
// RLS gates every command on is_club_admin(event's club), and only the
// analyze_report task reads them. Judging never sees this table and this
// feature never reads judging_criteria.

export async function listReportCriteria(eventId: string): Promise<EventReportAnalysisCriterion[]> {
  const { data, error } = await supabase
    .from('event_report_analysis_criteria').select('*').eq('event_id', eventId)
    .order('sort_order').order('created_at')
  throwIf(error)
  return (data ?? []) as EventReportAnalysisCriterion[]
}

export async function createReportCriterion(fields: Partial<EventReportAnalysisCriterion> & {
  event_id: string; name: string
}): Promise<EventReportAnalysisCriterion> {
  const { data, error } = await supabase
    .from('event_report_analysis_criteria').insert(fields).select().single()
  throwIf(error)
  return data as EventReportAnalysisCriterion
}

export async function updateReportCriterion(
  id: string, fields: Partial<EventReportAnalysisCriterion>,
): Promise<EventReportAnalysisCriterion> {
  const { data, error } = await supabase
    .from('event_report_analysis_criteria').update(fields).eq('id', id).select().single()
  throwIf(error)
  return data as EventReportAnalysisCriterion
}

export async function deleteReportCriterion(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('event_report_analysis_criteria').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Criterion was not deleted — you do not have permission.')
  }
}

// Club authority only (super_admin / club_admin / convener — is_club_admin);
// storage RLS and the Edge Function both enforce it server-side. The report
// lives under reports/{event}/ in the PRIVATE submission-docs bucket (PDF
// only, 10 MB — the bucket enforces both) and the analysis is returned to the
// caller, never written into judging.

export function eventReportPath(eventId: string, fileName: string): string {
  const safe = fileName.toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9._-]+/g, '-').slice(0, 60) || 'report'
  return `reports/${eventId}/${safe}-${Date.now()}.pdf`
}

export async function uploadEventReport(eventId: string, file: File): Promise<{ path: string; name: string }> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF documents are supported for report analysis.')
  if (file.size > SUBMISSION_DOC_MAX_BYTES) throw new Error('This PDF is too large — the limit is 10 MB.')
  const path = eventReportPath(eventId, file.name)
  const { error } = await supabase.storage
    .from('submission-docs')
    .upload(path, file, { upsert: true, contentType: 'application/pdf' })
  throwIf(error)
  return { path, name: file.name }
}

export async function removeEventReport(path: string): Promise<void> {
  const { error } = await supabase.storage.from('submission-docs').remove([path])
  throwIf(error)
}

export async function analyzeEventReport(eventId: string, documentPath: string): Promise<EventReportAnalysis> {
  const res = await invokeAi<{ analysis: EventReportAnalysis }>({
    task: 'analyze_report', event_id: eventId, document_path: documentPath,
  })
  return res.analysis
}

// organizer-facing summary of a form's responses (not stored)
export async function analyzeFeedbackWithAi(formId: string): Promise<AiFeedbackAnalysis> {
  const res = await invokeAi<{ analysis: AiFeedbackAnalysis }>({
    task: 'analyze_feedback', form_id: formId,
  })
  return res.analysis
}

export async function getJudgingResults(eventId: string): Promise<JudgingResult[]> {
  const { data, error } = await supabase.rpc('get_judging_results', { p_event_id: eventId })
  throwIf(error)
  return (data ?? []) as JudgingResult[]
}

// ---- analytics / certificates (ADR-0012) --------------------------------------

// staff-only via scans RLS; analytics aggregates client-side
export async function listScans(eventId: string, limit = 1000): Promise<ScanRecord[]> {
  const { data, error } = await supabase
    .from('scans').select('*').eq('event_id', eventId)
    .order('created_at', { ascending: false }).limit(limit)
  throwIf(error)
  return (data ?? []) as ScanRecord[]
}

// RLS scopes rows: managers see all of the event's certificates, holders their own
export async function listCertificates(eventId: string): Promise<Certificate[]> {
  const { data, error } = await supabase
    .from('certificates').select('*').eq('event_id', eventId)
    .order('created_at', { ascending: false })
  throwIf(error)
  return (data ?? []) as Certificate[]
}

export async function issueCertificates(input: {
  eventId: string; kind: CertificateKind; title: string; detail?: string
  scope: 'registered' | 'attended' | 'participant' | 'team'; targetId?: string
}): Promise<{ issued: number; skipped: number }> {
  const { data, error } = await supabase.rpc('issue_certificates', {
    p_event_id: input.eventId, p_kind: input.kind, p_title: input.title,
    p_detail: input.detail ?? '', p_scope: input.scope, p_target_id: input.targetId ?? null,
  })
  throwIf(error)
  return data as { issued: number; skipped: number }
}

export async function revokeCertificate(id: string): Promise<void> {
  const { data, error } = await supabase.from('certificates').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Certificate was not revoked — you do not have permission.')
  }
}

// anon-safe public verification by opaque code
export async function verifyCertificate(code: string): Promise<VerifiedCertificate> {
  const { data, error } = await supabase.rpc('verify_certificate', { p_code: code.trim() })
  throwIf(error)
  return data as VerifiedCertificate
}

// LLM-backed assistant (Edge Function; ADR-0012). Throws when not deployed —
// callers fall back to the deterministic data-lookup answers.
export async function askEventAssistant(eventId: string, question: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('event-assistant', {
    body: { event_id: eventId, question },
  })
  if (error) throw new Error(error.message)
  const answer = (data as { answer?: string } | null)?.answer
  if (!answer) throw new Error('No answer from assistant')
  return answer
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
  const { data, error } = await supabase
    .from('activities').delete().eq('id', id).select('id')
  throwIf(error)
  if (!data || data.length === 0) {
    throw new Error('Task was not deleted — you do not have permission.')
  }
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

export async function uploadClubMedia(clubId: string, file: File, kind: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'png'
  const path = `clubs/${clubId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('event-media').upload(path, file, { upsert: true })
  throwIf(error)
  return supabase.storage.from('event-media').getPublicUrl(path).data.publicUrl
}

export async function uploadEventMedia(eventId: string, file: File, kind: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'png'
  const path = `${eventId}/${kind}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('event-media').upload(path, file, { upsert: true })
  throwIf(error)
  return supabase.storage.from('event-media').getPublicUrl(path).data.publicUrl
}
