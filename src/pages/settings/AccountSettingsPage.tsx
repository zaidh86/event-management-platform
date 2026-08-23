import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { updateMyProfile } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme, type ThemePref } from '../../contexts/ThemeContext'
import { useToast } from '../../components/ui/Toast'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { platformRoleLabel } from '../../lib/roles'

// Personal settings (/settings): the signed-in person's own account and
// appearance preferences. Platform administration is a separate area (/admin)
// so platform-wide controls never mix with personal ones (ADR-0010).
export function AccountSettingsPage() {
  const { session, profile, isSuperAdmin, refreshProfile } = useAuth()
  const toast = useToast()
  const { pref, setPref } = useTheme()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!session) return null
  const roleLabel = platformRoleLabel(profile?.role)

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (busy || !session) return
    setBusy(true)
    setError(null)
    try {
      await updateMyProfile(session.user.id, name)
      await refreshProfile()
      toast('success', 'Profile updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      toast('error', 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const THEME_OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ]

  return (
    <div className="page page-narrow">
      <h1>Settings</h1>

      <section className="card stack">
        <h2>Account</h2>
        <form onSubmit={(e) => void onSave(e)} className="stack">
          <label>
            Display name <span className="field-hint">Write your Full Name</span>
            <input
              value={name} maxLength={80}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </label>
          <label>
            Email
            <input value={session.user.email ?? ''} disabled aria-describedby="email-note" />
          </label>
          <p className="muted" id="email-note">
            Your email identifies your account and is managed through sign-in.
          </p>
          {roleLabel && (
            <p className="muted">
              Platform role: <span className="badge badge-admin">{roleLabel}</span>
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      <ChangePasswordSection />

      <section className="card stack">
        <h2>Appearance</h2>
        <p className="muted">Choose how EMP looks on this device.</p>
        <div className="theme-choice" role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value} type="button" role="radio" aria-checked={pref === value}
              className="mode-card theme-choice-card"
              onClick={() => setPref(value)}
            >
              <span className="mode-card-title"><Icon size={18} aria-hidden /> {label}</span>
            </button>
          ))}
        </div>
      </section>

      {isSuperAdmin && (
        <section className="card stack">
          <h2>Platform administration</h2>
          <p className="muted">
            Manage platform administrators, ownership and featured events.
          </p>
          <div className="row">
            <Link to="/admin" className="btn btn-ghost">
              <ShieldCheck size={16} aria-hidden /> Open platform settings
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}

// Password change through Supabase Auth (the provider stores/handles the
// password; EMP never sees, stores or logs it — ADR-0010 personal-settings
// scope). The CURRENT password is verified by re-authenticating the signed-in
// user against Supabase Auth (signInWithPassword with the session's own
// email) — never by any frontend comparison, and the update is only attempted
// after that verification succeeds. A correct re-auth refreshes the same
// user's session, so they stay logged in; a failed one leaves the existing
// session untouched.
function ChangePasswordSection() {
  const { session } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return // double-submit guard beyond the disabled button
    setError(null)
    if (current === '') {
      setError('Enter your current password.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('New passwords do not match.')
      return
    }
    const email = session?.user.email
    if (!email) {
      setError('Could not determine your account email — try signing in again.')
      return
    }
    setBusy(true)
    try {
      // 1) verify the CURRENT password with the auth provider (source of truth)
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email, password: current,
      })
      if (reauthErr) {
        setError('Current password is incorrect.')
        return
      }
      // 2) only after successful re-authentication, set the new password
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) {
        setError(err.message)
        toast('error', 'Password change failed')
        return
      }
      setCurrent('')
      setPassword('')
      setConfirm('')
      toast('success', 'Password changed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <h2>Password</h2>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          Current password
          <PasswordInput
            value={current} required
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          New password
          <PasswordInput
            value={password} minLength={8} required
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirm new password
          <PasswordInput
            value={confirm} minLength={8} required
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  )
}
