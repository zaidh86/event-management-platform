// Domain types mirroring the database rows (supabase/migrations/00001_init.sql).

export type GlobalRole = 'user' | 'super_admin' | 'platform_owner'
// Club standing. club_admin and convener both carry FULL club authority —
// convener is the faculty-held form of it (a teacher who runs the club).
// faculty is a teacher ASSOCIATED with the club and carries none: it sits
// beside 'member', not above it. Authority is decided in exactly one place —
// isClubAuthority() in lib/roles.ts, mirroring is_club_admin() in SQL.
export type ClubRole = 'club_admin' | 'convener' | 'faculty' | 'member'
export type EventRole = 'organizer' | 'activity_admin' | 'volunteer' | 'participant' | 'judge'
export type EventStatus = 'draft' | 'active' | 'ended' | 'archived'
export type ActivityKind = 'configured' | 'integrated'
export type TransactionType = 'award' | 'deduct' | 'entry_fee' | 'adjustment' | 'starting_balance'
export type OwnerType = 'participant' | 'team'
export type ParticipationMode = 'solo' | 'team'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: GlobalRole
  created_at: string
}

export interface RegistrationField {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  required: boolean
  options?: string[]
}

export interface Club {
  id: string
  slug: string
  name: string
  // concise identity for listings, e.g. "Department of Computer Science";
  // absent on pre-00019 rows
  department?: string
  description: string
  logo_url: string | null
  banner_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ClubMember {
  id: string
  club_id: string
  user_id: string
  role: ClubRole
  created_at: string
}

// Capability flags gating event features (ADR-0003). Absent keys mean false;
// rows from before migration 00006 normalize to the legacy game-set.
export interface EventCapabilities {
  // participation availability: which modes participants may choose (ADR-0007)
  solo: boolean
  teams: boolean
  points: boolean
  qr: boolean
  attendance: boolean
  submissions: boolean
  judging: boolean
  deadlines: boolean
  feedback: boolean
  certificates: boolean
  games_api: boolean
}

// Leaderboard configuration (ADR-0008). Absent keys mean legacy defaults —
// see normalizeLeaderboardConfig in lib/leaderboard.ts.
export type LeaderboardEntity = 'auto' | 'individuals' | 'teams' | 'combined'
export type LeaderboardMetric = 'balance' | 'tasks'
export type LeaderboardVisibility = 'public' | 'participants' | 'hidden'

export interface LeaderboardConfig {
  enabled: boolean
  entity: LeaderboardEntity
  metric: LeaderboardMetric
  visibility: LeaderboardVisibility
  show_member_count: boolean
}

// Submissions & judging (ADR-0011). Absent keys mean defaults - see
// normalizeSubmissionConfig in lib/submissions.ts.
export interface SubmissionConfig {
  deadline: string | null
  instructions: string
  fields: RegistrationField[]
  results_visibility: 'hidden' | 'participants'
  // AI-assisted judging (00022): when on, judges may request AI score
  // suggestions for an entry. Suggestions are advisory — never the final score.
  ai_assist: boolean
}

// Event table allocation (00022). Absent keys mean disabled — see
// normalizeTableConfig in lib/tables.ts.
export interface TableConfig {
  enabled: boolean
  start_number: number
  label: string
}

// one allocated table per registration unit (solo participant or team)
export interface EventTable {
  id: string
  event_id: string
  participant_id: string | null
  team_id: string | null
  table_number: number
  created_at: string
}

export interface Submission {
  id: string
  event_id: string
  participant_id: string | null
  team_id: string | null
  title: string
  description: string
  content: Record<string, unknown>
  // optional attached PDF (00020): private submission-docs storage object
  document_path?: string | null
  document_name?: string | null
  status: 'draft' | 'submitted'
  submitted_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface JudgingCriterion {
  id: string
  event_id: string
  name: string
  // human-facing evaluation guidance ("what does this criterion mean?")
  description: string
  // what an AI should look for when suggesting a score (00022); absent on
  // pre-00022 rows, empty = fall back to description
  ai_instructions?: string
  max_score: number
  weight: number
  required: boolean
  sort_order: number
  is_enabled: boolean
  created_at: string
  updated_at: string
}

// per-criterion AI suggestion (stored in judge_evaluations.details, 00022)
export interface AiCriterionSuggestion {
  criterion_id: string
  criterion: string
  suggested_score: number
  max_score: number
  reasoning: string
  evidence: string[]
}

export interface AiJudgingDetails {
  model?: string
  generated_at?: string
  summary?: string
  strengths?: string[]
  weaknesses?: string[]
  suggestions?: AiCriterionSuggestion[]
}

export interface JudgeEvaluation {
  id: string
  event_id: string
  submission_id: string
  judge_id: string | null
  source: 'human' | 'ai'
  scores: Record<string, number>
  notes: string
  // AI rows: structured reasoning/evidence (00022); human rows: {}
  details?: AiJudgingDetails
  status: 'draft' | 'final'
  created_at: string
  updated_at: string
}

// organizer-facing AI feedback analysis (returned by the ai-service Edge
// Function; never stored)
export interface AiFeedbackAnalysis {
  model?: string
  response_count: number
  summary: string
  went_well: string[]
  positive_themes: string[]
  needs_improvement: string[]
  complaints: string[]
  recommended_actions: string[]
  priority: string
}

export interface JudgingResult {
  submission_id: string
  title: string
  owner_type: OwnerType
  owner_name: string
  evaluation_count: number
  finalized_count: number
  raw_total: number
  weighted_total: number
  breakdown: Record<string, {
    name: string; max_score: number; weight: number; avg_score: number; weighted: number
  }>
}

export interface EmpEvent {
  id: string
  name: string
  slug: string
  club_id: string | null
  capabilities: EventCapabilities
  leaderboard_config: LeaderboardConfig
  submission_config: SubmissionConfig
  table_config: TableConfig
  description: string
  status: EventStatus
  is_team_event: boolean
  team_size_min: number
  team_size_max: number
  currency_name: string
  currency_name_plural: string
  currency_image_url: string | null
  starting_balance: number
  min_balance: number
  allow_negative: boolean
  registration_fields: RegistrationField[]
  logo_url: string | null
  banner_url: string | null
  theme_color: string
  public_leaderboard: boolean
  // platform curation (ADR-0010): set only by platform admins, trigger-guarded
  is_featured: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface EventMember {
  id: string
  event_id: string
  user_id: string
  role: EventRole
  created_at: string
}

export interface Team {
  id: string
  event_id: string
  name: string
  qr_token: string
  created_by: string
  created_at: string
}

export interface Participant {
  id: string
  event_id: string
  user_id: string
  team_id: string | null
  // the participant's CHOSEN mode — source of truth for their dashboard (ADR-0007)
  participation_mode: ParticipationMode
  display_name: string
  registration_data: Record<string, unknown>
  qr_token: string
  created_at: string
}

export interface Account {
  id: string
  event_id: string
  owner_type: OwnerType
  owner_id: string
  balance: number
  updated_at: string
}

export interface ActivityConfig {
  entry_fee?: number
  reward?: number
  deduction?: number
  time_limit_seconds?: number
  rules?: string
  [key: string]: unknown
}

export interface Activity {
  id: string
  event_id: string
  name: string
  description: string
  kind: ActivityKind
  config: ActivityConfig
  api_key_hash: string | null
  is_active: boolean
  created_by: string
  created_at: string
}

export interface Transaction {
  id: string
  event_id: string
  account_id: string
  activity_id: string | null
  amount: number
  type: TransactionType
  description: string
  metadata: Record<string, unknown>
  actor_id: string | null
  actor_label: string | null
  created_at: string
}

export interface Announcement {
  id: string
  event_id: string
  title: string
  body: string
  created_by: string
  created_at: string
}

export interface LeaderboardRow {
  rank: number
  account_id: string
  owner_type: OwnerType
  owner_id: string
  name: string
  balance: number
  member_count: number
  // absent when the live database predates migration 00013
  tasks_completed?: number
}

// ---- universal QR operations (ADR-0009) ------------------------------------

export type QrTarget = 'participant' | 'team' | 'event' | 'feedback'
export type QrAction =
  | 'attendance' | 'scoring' | 'verification' // station actions (participant/team)
  | 'registration' | 'info'                   // event target
  | 'feedback'                                // feedback target
export type ScannerAccess = 'organizer' | 'activity_admin' | 'volunteer' | 'judge' | 'participant' | 'public'

export interface QrConfig {
  id: string
  event_id: string
  label: string
  description: string
  target: QrTarget
  actions: QrAction[]
  scanner_access: ScannerAccess[]
  is_enabled: boolean
  config: { feedback_form_id?: string; [key: string]: unknown }
  qr_token: string
  sort_order: number
  created_by: string
  created_at: string
  updated_at: string
}

// what perform_scan returns; scoring outcomes carry the account context the
// award panel needs (compatible with the legacy QrResolution shape)
export interface ScanOutcome {
  status: 'ok' | 'duplicate'
  action: QrAction
  kind?: OwnerType
  name: string
  // feedback action: the configured form the scan resolves to
  form_id?: string
  form_title?: string
  participant_id?: string
  participant_name?: string
  team_id?: string
  account_id?: string
  balance?: number
  recorded_at?: string
}

export interface ScanRecord {
  id: string
  event_id: string
  qr_config_id: string | null
  target: QrTarget
  target_id: string | null
  action: QrAction
  scanned_by: string | null
  result: 'ok' | 'duplicate' | 'rejected'
  metadata: Record<string, unknown>
  created_at: string
}

export interface AttendanceRecord {
  id: string
  event_id: string
  participant_id: string
  scan_id: string | null
  recorded_by: string | null
  created_at: string
}

// ---- feedback (ADR-0009) ----------------------------------------------------

export type FeedbackQuestionType = 'short_text' | 'long_text' | 'rating' | 'single_choice' | 'multi_choice'

export interface FeedbackQuestion {
  key: string
  label: string
  type: FeedbackQuestionType
  required: boolean
  options?: string[]
  max_rating?: number
}

export interface FeedbackForm {
  id: string
  event_id: string
  // reflections reuse the feedback engine (ADR-0012); absent on pre-00017 rows
  kind?: 'feedback' | 'reflection'
  title: string
  description: string
  questions: FeedbackQuestion[]
  status: 'draft' | 'published' | 'closed'
  access: 'public' | 'participants'
  // no longer enforced since 00022 (generic feedback allows repeat responses)
  one_response_per_user: boolean
  created_by: string
  created_at: string
  updated_at: string
}

// Who a response came from, stamped server-side at submission time (00021).
// 'faculty' covers both faculty and convener club standing in the EVENT'S OWN
// club; 'anonymous' is an unattributable respondent, which is NOT the same
// claim as 'regular'. Absent/null on rows recorded before 00021 — those are
// genuinely unclassified and must never be presented as either category.
export type FeedbackRespondentCategory = 'faculty' | 'regular' | 'anonymous'

export interface FeedbackResponse {
  id: string
  form_id: string
  event_id: string
  respondent_id: string | null
  // 00019 target columns — retired in 00022 (feedback is generic); always
  // 'event'/null on new rows, kept for historical rows only
  target_type?: 'event' | 'team' | 'participant'
  target_id?: string | null
  // absent on pre-00021 rows — see FeedbackRespondentCategory
  respondent_category?: FeedbackRespondentCategory | null
  answers: Record<string, unknown>
  created_at: string
}

// ---- participant removal (00021) --------------------------------------------

// What remove_event_participant() returns. 'blocked' is a refusal the organizer
// can act on, not an error: override_allowed distinguishes "confirm and it will
// proceed" from "this can never proceed until you delete the submission".
export interface ParticipantRemovalResult {
  status: 'ok' | 'blocked'
  display_name: string
  // status = 'blocked'
  override_allowed?: boolean
  reasons?: string[]
  hint?: string
  // status = 'ok'
  account_deleted?: boolean
  transactions_deleted?: number
  certificates_deleted?: number
  attendance_deleted?: boolean
  team_id?: string | null
  team_now_empty?: boolean
}

// ---- certificates (ADR-0012) -------------------------------------------------

export type CertificateKind = 'participation' | 'achievement' | 'completion'

export interface Certificate {
  id: string
  event_id: string
  participant_id: string | null
  team_id: string | null
  kind: CertificateKind
  title: string
  detail: string
  verify_code: string
  issued_by: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface VerifiedCertificate {
  valid: boolean
  event_name?: string
  event_logo_url?: string | null
  theme_color?: string
  holder_name?: string
  holder_type?: OwnerType
  kind?: CertificateKind
  title?: string
  detail?: string
  issued_at?: string
  verify_code?: string
}

// what resolve_public_qr returns for q_ tokens (event/feedback targets)
export interface PublicQrResolution {
  target: 'event' | 'feedback'
  requires_signin?: boolean
  actions?: QrAction[]
  action?: QrAction
  label?: string
  description?: string
  event_id?: string
  event_name: string
  event_slug?: string
  event_description?: string
  event_status?: EventStatus
  logo_url?: string | null
  banner_url?: string | null
  theme_color?: string
  form_id?: string
  form_title?: string
}

export interface QrResolution {
  kind: OwnerType
  event_id: string
  participant_id?: string
  participant_name?: string
  team_id?: string
  name: string
  account_id: string
  balance: number
}
