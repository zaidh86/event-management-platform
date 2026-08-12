// Domain types mirroring the database rows (supabase/migrations/00001_init.sql).

export type GlobalRole = 'user' | 'super_admin'
export type EventRole = 'organizer' | 'activity_admin' | 'volunteer' | 'participant'
export type EventStatus = 'draft' | 'active' | 'ended' | 'archived'
export type ActivityKind = 'configured' | 'integrated'
export type TransactionType = 'award' | 'deduct' | 'entry_fee' | 'adjustment' | 'starting_balance'
export type OwnerType = 'participant' | 'team'

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

export interface EmpEvent {
  id: string
  name: string
  slug: string
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
