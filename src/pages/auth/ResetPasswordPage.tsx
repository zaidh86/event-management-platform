import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// Landing page of the recovery email link. Supabase's redirect signs the user
// into a recovery session (detectSessionInUrl); with that session present,
// updateUser sets the new password. Without it, the link is invalid/expired.
export function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  if (loading) return <div className="page-loading">Loading…</div>

  if (!session) {
    return (
      <div className="auth-card">
        <h1>Recovery link invalid</h1>
        <p className="muted">
          This password recovery link is invalid or has expired. Request a new
          one and open it promptly on this device.
        </p>
        <Link to="/forgot-password" className="btn btn-primary">Request a new link</Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="auth-card">
        <h1>Password updated</h1>
        <p className="muted">You're logged in with your new password.</p>
        <button className="btn btn-primary" onClick={() => navigate('/', { replace: true })}>
          Continue to EMP
        </button>
      </div>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setDone(true)
  }

  return (
    <div className="auth-card">
      <h1>Set a new password</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          New password
          <input
            type="password" value={password} minLength={8} required
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password" value={confirm} minLength={8} required
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  )
}
