import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { resolvePublicQr } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import type { PublicQrResolution } from '../../lib/types'

// Landing page for scanned event/feedback QR codes (/q/:token). Poster and
// venue QRs encode this URL so any phone camera opens it — no sign-in needed
// to LOOK; registration itself still goes through the normal signed-in flow.
// The server (resolve_public_qr) decides what this token exposes.
export function PublicQrPage() {
  const { token } = useParams<{ token: string }>()
  const { session } = useAuth()
  const user = session?.user ?? null
  const [info, setInfo] = useState<PublicQrResolution | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    resolvePublicQr(token)
      .then(setInfo)
      .catch((e: Error) => setError(
        /schema cache|could not find/i.test(e.message)
          ? 'This QR link is not available right now. Please try again later.'
          : e.message,
      ))
  }, [token])

  if (error) {
    return (
      <div className="public-landing">
        <p className="form-error">{error}</p>
        <Link to="/" className="btn btn-ghost">Go to EMP</Link>
      </div>
    )
  }
  if (!info) return <div className="public-landing"><p className="muted">Loading…</p></div>

  // feedback QR: hand off to the form (or ask for sign-in for participant forms)
  if (info.target === 'feedback') {
    if (info.requires_signin) {
      return (
        <div className="public-landing">
          <h1>{info.form_title}</h1>
          <p className="muted">
            This feedback form for <strong>{info.event_name}</strong> is open to
            event participants. Sign in to continue.
          </p>
          <Link to="/login" className="btn btn-primary">Sign in</Link>
        </div>
      )
    }
    return <Navigate to={`/f/${info.form_id}`} replace />
  }

  // event QR: public promotional surface
  const canRegister = info.actions?.includes('registration') && info.event_status === 'active'
  return (
    <div
      className="public-landing"
      style={info.theme_color ? { ['--theme' as string]: info.theme_color } : undefined}
    >
      {info.banner_url && <img src={info.banner_url} alt="" className="event-banner" />}
      <header className="public-landing-head">
        {info.logo_url && <img src={info.logo_url} alt="" className="event-logo" />}
        <h1>{info.event_name}</h1>
        {info.event_status === 'ended' && <p className="muted">This event has ended.</p>}
      </header>
      {info.event_description && <p className="public-landing-desc">{info.event_description}</p>}
      <div className="row public-landing-actions">
        {canRegister && (
          user
            ? <Link to={`/events/${info.event_id}/dashboard`} className="btn btn-primary">Register / open my dashboard</Link>
            : <Link to="/login" className="btn btn-primary">Sign in to register</Link>
        )}
        {!canRegister && info.actions?.includes('info') && user && (
          <Link to={`/events/${info.event_id}`} className="btn btn-ghost">Open event</Link>
        )}
        {!user && !canRegister && (
          <Link to="/login" className="btn btn-ghost">Sign in to EMP</Link>
        )}
      </div>
    </div>
  )
}
