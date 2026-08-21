import {
  countAttendance, countFeedbackResponses, getJudgingResults, listActivities,
  listEventTransactions, listFeedbackForms, listMembers, listParticipants,
  listScans, listSubmissions, listTeams,
} from './api'
import type { EventAggregates } from './insights'
import type { EmpEvent } from './types'

// One manager-scoped snapshot of everything the event has actually recorded.
// Capability-off areas load as null so downstream code distinguishes
// "not enabled" from "zero" (ADR-0012: never invent a metric).
export async function loadEventAggregates(event: EmpEvent): Promise<EventAggregates> {
  const [participants, teams, activities, members] = await Promise.all([
    listParticipants(event.id).catch(() => []),
    listTeams(event.id).catch(() => []),
    listActivities(event.id).catch(() => []),
    listMembers(event.id).catch(() => []),
  ])
  const [attendance, scans, transactions, submissions, judging] = await Promise.all([
    event.capabilities.attendance ? countAttendance(event.id).catch(() => null) : null,
    event.capabilities.qr ? listScans(event.id).catch(() => null) : null,
    event.capabilities.points ? listEventTransactions(event.id, 1000).catch(() => null) : null,
    event.capabilities.submissions ? listSubmissions(event.id).catch(() => null) : null,
    event.capabilities.judging ? getJudgingResults(event.id).catch(() => null) : null,
  ])
  let feedbackForms: EventAggregates['feedbackForms'] = null
  if (event.capabilities.feedback) {
    const forms = await listFeedbackForms(event.id).catch(() => [])
    feedbackForms = await Promise.all(forms.map(async (f) => ({
      ...f, responseCount: await countFeedbackResponses(f.id).catch(() => 0),
    })))
  }
  return {
    event,
    participantCount: participants.length,
    soloCount: participants.filter((p) => p.participation_mode === 'solo').length,
    teamModeCount: participants.filter((p) => p.participation_mode === 'team').length,
    teamCount: teams.length,
    attendanceCount: attendance,
    scans,
    transactions,
    activityCount: activities.length,
    submissions,
    judging,
    judgeCount: members.filter((m) => m.role === 'judge').length,
    feedbackForms,
  }
}
