import type { EmpEvent } from './types'

// Registration deadline (00026). The deadline is a single absolute instant
// (timestamptz), so every comparison here is instant-vs-instant — no local
// wall-clock strings, no assumption about the viewer's or the event's zone.
// NULL means "no deadline", which is how every event behaved before 00026.
//
// The database re-checks this inside register_for_event(); everything below is
// UX so the button matches what the server will actually allow.

export function registrationClosed(
  event: Pick<EmpEvent, 'registration_deadline'>,
  now: number = Date.now(),
): boolean {
  const deadline = event.registration_deadline
  if (!deadline) return false
  const at = new Date(deadline).getTime()
  return Number.isFinite(at) && now >= at
}

// <input type="datetime-local"> has no timezone: it reads and writes the
// viewer's local wall clock. Convert explicitly in both directions so the
// stored instant round-trips — slicing an ISO string (as the older submission
// deadline field does) silently reinterprets UTC digits as local ones.
export function toDeadlineInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// '' clears the deadline (stored as NULL); anything else becomes the instant
// the entered local time denotes.
export function fromDeadlineInput(local: string): string | null {
  if (local.trim() === '') return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
