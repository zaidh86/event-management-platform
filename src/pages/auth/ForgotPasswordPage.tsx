import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// Password recovery via Supabase Auth: EMP never handles or stores passwords —
// the provider emails a recovery link that signs the user into a recovery
// session on /reset-password, where they set the new password.
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="auth-card">
        <h1>Check your email</h1>
        <p className="muted">
          If an account exists for <strong>{email}</strong>, a password recovery
          link is on its way. Open it on this device to set a new password.
        </p>
        <p className="auth-alt"><Link to="/login">Back to log in</Link></p>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h1>Forgot password</h1>
      <p className="muted">
        Enter your account email and we'll send you a recovery link.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          Email
          <input
            type="email" value={email} required autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send recovery link'}
        </button>
      </form>
      <p className="auth-alt">Remembered it? <Link to="/login">Log in</Link></p>
    </div>
  )
}
