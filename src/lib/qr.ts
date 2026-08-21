import type { QrAction, QrConfig, QrTarget, ScannerAccess } from './types'

// Universal QR operations (ADR-0009): pure helpers shared by the settings
// builder, the participant dashboard and the scan station. Validity rules
// mirror the qr_configs CHECK constraints — the database remains the enforcer.

export const TARGET_ACTIONS: Record<QrTarget, QrAction[]> = {
  participant: ['attendance', 'scoring', 'verification', 'feedback'],
  team: ['scoring', 'verification', 'feedback'],
  event: ['registration', 'info'],
  feedback: ['feedback'],
}

export const TARGET_LABELS: Record<QrTarget, string> = {
  participant: 'Participant',
  team: 'Team',
  event: 'Event',
  feedback: 'Feedback form',
}

export const ACTION_LABELS: Record<QrAction, string> = {
  attendance: 'Attendance / check-in',
  scoring: 'Scoring',
  verification: 'Verification',
  registration: 'Open registration',
  info: 'Event information',
  feedback: 'Open feedback form',
}

export const ACCESS_LABELS: Record<ScannerAccess, string> = {
  organizer: 'Event Managers',
  activity_admin: 'Task admins',
  volunteer: 'Volunteers',
  judge: 'Judges',
  participant: 'Participants (self-service)',
  public: 'Public (no sign-in)',
}

// which scanner-access choices make sense per target
export function accessOptionsFor(target: QrTarget): ScannerAccess[] {
  return target === 'event' || target === 'feedback'
    ? ['public', 'participant', 'organizer', 'activity_admin', 'volunteer']
    : ['organizer', 'activity_admin', 'volunteer', 'judge', 'participant']
}

// station-scannable configs (what the scan page offers as operations)
export function stationConfigs(configs: QrConfig[]): QrConfig[] {
  return configs.filter(
    (c) => c.is_enabled && (c.target === 'participant' || c.target === 'team'),
  )
}

// configs rendered as cards in a participant's "My QR codes":
// participant-target configs always apply; team-target configs only once the
// participant (in team mode) actually has a team — never a fake team QR.
export function myQrConfigs(
  configs: QrConfig[],
  isTeamMode: boolean,
  hasTeam: boolean,
): { participant: QrConfig[]; team: QrConfig[] } {
  const enabled = configs.filter((c) => c.is_enabled)
  return {
    participant: enabled.filter((c) => c.target === 'participant'),
    team: isTeamMode && hasTeam ? enabled.filter((c) => c.target === 'team') : [],
  }
}

// public landing URL encoded into event/feedback QR images — any phone camera
// can open it (station QRs stay raw opaque tokens read by the EMP scanner)
export function publicQrUrl(token: string): string {
  return `${window.location.origin}/q/${token}`
}

export function summarizeActions(actions: QrAction[]): string {
  return actions.map((a) => ACTION_LABELS[a]).join(', ')
}

export function summarizeAccess(access: ScannerAccess[]): string {
  return access.map((a) => ACCESS_LABELS[a]).join(', ')
}
