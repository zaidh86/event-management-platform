import type {
  EmpEvent, FeedbackForm, FeedbackResponse, JudgingResult, ScanRecord,
  Submission, Transaction,
} from './types'

// Deterministic, rule-based analysis over REAL event data (ADR-0012).
// This is NOT an LLM: every line below is computed arithmetic over rows the
// caller loaded under their own permissions, labeled as such in the UI.
// When data is missing the engine says so — it never invents a metric.

export interface EventAggregates {
  event: EmpEvent
  participantCount: number
  soloCount: number
  teamModeCount: number
  teamCount: number
  attendanceCount: number | null // null = attendance capability off
  scans: ScanRecord[] | null
  transactions: Transaction[] | null
  activityCount: number
  submissions: Submission[] | null
  judging: JudgingResult[] | null
  judgeCount: number
  feedbackForms: (FeedbackForm & { responseCount: number })[] | null
}

export interface Insight {
  kind: 'finding' | 'gap'
  text: string
}

export function buildInsights(a: EventAggregates): Insight[] {
  const out: Insight[] = []
  const ev = a.event

  if (a.participantCount === 0) {
    out.push({ kind: 'gap', text: 'No participants have registered yet — most metrics below need registrations first.' })
    return out
  }
  out.push({
    kind: 'finding',
    text: `${a.participantCount} registered participant${a.participantCount === 1 ? '' : 's'}`
      + (a.teamModeCount > 0
        ? ` — ${a.soloCount} solo, ${a.teamModeCount} in team mode across ${a.teamCount} team${a.teamCount === 1 ? '' : 's'}.`
        : '.'),
  })

  if (a.attendanceCount !== null) {
    const rate = Math.round((a.attendanceCount / a.participantCount) * 100)
    out.push({
      kind: 'finding',
      text: `Attendance: ${a.attendanceCount} of ${a.participantCount} checked in (${rate}%).`,
    })
  }

  if (a.scans !== null && a.scans.length > 0) {
    const byAction = new Map<string, number>()
    for (const s of a.scans) byAction.set(s.action, (byAction.get(s.action) ?? 0) + 1)
    const parts = [...byAction.entries()].map(([k, n]) => `${n} ${k}`).join(', ')
    const dup = a.scans.filter((s) => s.result === 'duplicate').length
    out.push({
      kind: 'finding',
      text: `${a.scans.length} QR operations recorded (${parts})${dup > 0 ? `, including ${dup} duplicate attempt${dup === 1 ? '' : 's'}` : ''}.`,
    })
  }

  if (ev.capabilities.points && a.transactions !== null) {
    const awards = a.transactions.filter((t) => t.amount > 0 && t.type !== 'starting_balance')
    const withTask = a.transactions.filter((t) => t.activity_id !== null)
    out.push({
      kind: 'finding',
      text: `${a.transactions.length} ledger transactions — ${awards.length} awards; `
        + `${withTask.length} tied to a configured task (${a.activityCount} task${a.activityCount === 1 ? '' : 's'} configured).`,
    })
  }

  if (a.submissions !== null) {
    const submitted = a.submissions.filter((s) => s.status === 'submitted').length
    const drafts = a.submissions.length - submitted
    out.push({
      kind: 'finding',
      text: `Submissions: ${submitted} handed in${drafts > 0 ? `, ${drafts} still in draft` : ''}.`,
    })
    if (a.judging !== null && submitted > 0 && a.judgeCount > 0) {
      const fullyJudged = a.judging.filter((r) => r.finalized_count >= a.judgeCount).length
      out.push({
        kind: fullyJudged === submitted ? 'finding' : 'gap',
        text: `Judging: ${fullyJudged} of ${submitted} entries fully finalized by all ${a.judgeCount} judges.`,
      })
    }
  }

  if (a.feedbackForms !== null && a.feedbackForms.length > 0) {
    for (const f of a.feedbackForms) {
      if (f.status !== 'published') continue
      out.push({
        kind: 'finding',
        text: `${f.kind === 'reflection' ? 'Reflection' : 'Feedback'} "${f.title}": ${f.responseCount} response${f.responseCount === 1 ? '' : 's'}`
          + (f.access === 'participants' ? ` (${Math.round((f.responseCount / a.participantCount) * 100)}% of participants).` : '.'),
      })
    }
  }

  return out
}

export function buildRecommendations(a: EventAggregates): string[] {
  const recs: string[] = []
  const ev = a.event

  if (a.participantCount === 0) {
    if (ev.status === 'active') {
      recs.push('Share the event — an Event QR (Settings → QR operations) gives you a poster-ready registration link.')
    }
    return recs
  }
  if (a.attendanceCount !== null && a.attendanceCount / a.participantCount < 0.5) {
    recs.push(`Attendance is below half of registrations (${a.attendanceCount}/${a.participantCount}) — consider an announcement or check-in reminder.`)
  }
  if (ev.capabilities.points && a.transactions !== null
      && a.activityCount > 0 && !a.transactions.some((t) => t.activity_id !== null)) {
    recs.push('Tasks are configured but no transaction references one yet — stations may be recording untagged scores.')
  }
  if (a.submissions !== null) {
    const drafts = a.submissions.filter((s) => s.status === 'draft').length
    if (drafts > 0 && ev.submission_config.deadline) {
      recs.push(`${drafts} draft submission${drafts === 1 ? '' : 's'} not handed in — a deadline reminder announcement could help.`)
    }
    if (a.submissions.some((s) => s.status === 'submitted') && a.judgeCount === 0 && ev.capabilities.judging) {
      recs.push('Entries are submitted but no judges are assigned yet (Members & roles → Judge).')
    }
  }
  if (a.feedbackForms !== null && ev.status === 'ended'
      && !a.feedbackForms.some((f) => f.status === 'published')) {
    recs.push('The event has ended with no published feedback form — post-event feedback is most effective now.')
  }
  if (a.judging !== null && a.judgeCount > 0) {
    const incomplete = a.judging.filter((r) => r.finalized_count < a.judgeCount).length
    if (incomplete > 0) {
      recs.push(`${incomplete} entr${incomplete === 1 ? 'y' : 'ies'} still await${incomplete === 1 ? 's' : ''} finalized scores from some judges.`)
    }
  }
  return recs
}

// per-form response summary: counts, rating averages, choice distributions —
// computed, never guessed. Text answers are counted, not paraphrased.
export interface QuestionSummary {
  label: string
  type: string
  answered: number
  average?: number
  max?: number
  distribution?: { option: string; count: number }[]
}

export function summarizeResponses(
  form: FeedbackForm, responses: FeedbackResponse[],
): QuestionSummary[] {
  return form.questions.map((q) => {
    const values = responses
      .map((r) => r.answers[q.key])
      .filter((v) => v !== undefined && v !== null && v !== '')
    const base: QuestionSummary = { label: q.label, type: q.type, answered: values.length }
    if (q.type === 'rating') {
      const nums = values.map(Number).filter((n) => Number.isFinite(n))
      if (nums.length > 0) {
        base.average = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
        base.max = q.max_rating ?? 5
      }
    }
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const counts = new Map<string, number>()
      for (const v of values) {
        for (const o of Array.isArray(v) ? v : [v]) {
          counts.set(String(o), (counts.get(String(o)) ?? 0) + 1)
        }
      }
      base.distribution = (q.options ?? []).map((o) => ({ option: o, count: counts.get(o) ?? 0 }))
    }
    return base
  })
}

// deterministic answers for the assistant panel's data-lookup mode
export function answerFromData(question: string, a: EventAggregates): string {
  const q = question.toLowerCase()
  if (/(how many|number).*(register|participant)|registrations?/.test(q)) {
    return `${a.participantCount} participant${a.participantCount === 1 ? '' : 's'} registered (${a.soloCount} solo, ${a.teamModeCount} team mode).`
  }
  if (/attend|check.?in/.test(q)) {
    return a.attendanceCount === null
      ? 'Attendance tracking is not enabled for this event.'
      : `${a.attendanceCount} of ${a.participantCount} participants checked in.`
  }
  if (/team/.test(q)) {
    return `${a.teamCount} team${a.teamCount === 1 ? '' : 's'}; ${a.teamModeCount} participants registered in team mode.`
  }
  if (/submission|entry|entries/.test(q)) {
    if (a.submissions === null) return 'Submissions are not enabled for this event.'
    const submitted = a.submissions.filter((s) => s.status === 'submitted').length
    return `${submitted} submitted entr${submitted === 1 ? 'y' : 'ies'}, ${a.submissions.length - submitted} in draft.`
  }
  if (/judg|score|leading|top|winner/.test(q)) {
    if (a.judging === null || a.judging.length === 0) return 'No judging results yet.'
    const top = a.judging[0]
    return `Current top entry: "${top.title}" (${top.owner_name}) with weighted total ${Number(top.weighted_total).toFixed(2)} — ${top.finalized_count} finalized evaluation${top.finalized_count === 1 ? '' : 's'}.`
  }
  if (/feedback|reflection/.test(q)) {
    if (a.feedbackForms === null || a.feedbackForms.length === 0) return 'No feedback forms exist for this event.'
    return a.feedbackForms.map((f) => `"${f.title}": ${f.responseCount} responses`).join(' · ')
  }
  if (/scan|qr/.test(q)) {
    return a.scans === null || a.scans.length === 0
      ? 'No QR operations recorded yet.'
      : `${a.scans.length} scans recorded.`
  }
  return 'I can answer from this event’s data: registrations, teams, attendance, scans, submissions, judging, feedback. Try one of those.'
}
