import type { EmpEvent } from './types'

// Formats an amount using the event's configured currency name,
// singular/plural aware: "1 Chip", "250 Chips".
export function fmtPoints(event: Pick<EmpEvent, 'currency_name' | 'currency_name_plural'>, amount: number): string {
  const n = Number(amount)
  const name = Math.abs(n) === 1 ? event.currency_name : event.currency_name_plural
  return `${n.toLocaleString()} ${name}`
}

export function fmtSigned(event: Pick<EmpEvent, 'currency_name' | 'currency_name_plural'>, amount: number): string {
  const n = Number(amount)
  return `${n > 0 ? '+' : ''}${fmtPoints(event, n)}`
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
