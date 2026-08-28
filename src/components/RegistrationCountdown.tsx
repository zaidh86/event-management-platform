import { Fragment, useEffect, useRef, useState } from 'react'
import { fmtDateTime } from '../lib/format'

// Live countdown to an event's registration deadline (00026).
//
// Every tick recomputes the remaining time from the real clock rather than
// decrementing a stored number, so a throttled, backgrounded or suspended tab
// shows the truth the moment it wakes instead of drifting. When it reaches
// zero it calls onExpire once, letting the page swap to its closed state
// without a refresh — and the server rejects late registrations regardless.
function msLeft(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now())
}

const pad = (n: number) => String(n).padStart(2, '0')

export function RegistrationCountdown({ deadline, onExpire }: {
  deadline: string
  onExpire: () => void
}) {
  const deadlineMs = new Date(deadline).getTime()
  const [left, setLeft] = useState(() => msLeft(deadlineMs))
  // kept in a ref so a caller's inline arrow does not restart the interval
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    if (!Number.isFinite(deadlineMs)) return
    setLeft(msLeft(deadlineMs))
    const id = setInterval(() => {
      const next = msLeft(deadlineMs)
      setLeft(next)
      if (next <= 0) {
        clearInterval(id)
        expire.current()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [deadlineMs])

  if (!Number.isFinite(deadlineMs) || left <= 0) return null

  const total = Math.floor(left / 1000)
  const parts: [string, number][] = [
    ['Days', Math.floor(total / 86400)],
    ['Hours', Math.floor((total % 86400) / 3600)],
    ['Min', Math.floor((total % 3600) / 60)],
    ['Sec', total % 60],
  ]

  return (
    <div className="card reg-countdown">
      <p className="reg-countdown-label">Registration closes in</p>
      {/* no aria-live: a per-second live region would talk over everything.
          The label carries the same information on demand. */}
      <div
        className="reg-countdown-parts"
        role="timer"
        aria-label={`Registration closes in ${parts.map(([l, v]) => `${v} ${l}`).join(', ')}`}
      >
        {parts.map(([label, value], i) => (
          <Fragment key={label}>
            {i > 0 && <span className="reg-countdown-sep" aria-hidden>:</span>}
            <span className="reg-countdown-part" aria-hidden>
              <strong>{pad(value)}</strong>
              <small>{label}</small>
            </span>
          </Fragment>
        ))}
      </div>
      <p className="muted reg-countdown-when">Closes {fmtDateTime(deadline)}</p>
    </div>
  )
}
