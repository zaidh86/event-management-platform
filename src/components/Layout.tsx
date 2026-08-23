import { Link, Outlet, useNavigate } from 'react-router-dom'
import { Suspense } from 'react'
import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme, type ThemePref } from '../contexts/ThemeContext'
import { platformRoleLabel } from '../lib/roles'

// Theme selection for SIGNED-IN users lives in Settings → Appearance (single
// source of control). Signed-out visitors have no Settings page, so the topbar
// carries the same control for them — same ThemeContext, same persistence,
// same three preferences; nothing is duplicated in state.
const NEXT_PREF: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' }
const PREF_LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' }

function ThemeToggle() {
  const { pref, setPref } = useTheme()
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor
  const label = `Appearance: ${PREF_LABEL[pref]}. Switch to ${PREF_LABEL[NEXT_PREF[pref]]}.`
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      onClick={() => setPref(NEXT_PREF[pref])}
      title={label}
      aria-label={label}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}

export function AppLayout() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">EMP</Link>
        <nav className="topbar-nav">
          {session ? (
            <>
              <Link
                to="/settings" className="btn btn-ghost btn-icon"
                title="Settings" aria-label="Settings"
              >
                <Settings size={16} aria-hidden />
              </Link>
              <span className="topbar-user">
                {profile?.full_name || session.user.email}
                {platformRoleLabel(profile?.role) && (
                  <span className="badge badge-admin">{platformRoleLabel(profile?.role)}</span>
                )}
              </span>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  void signOut().then(() => navigate('/login'))
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <ThemeToggle />
              <Link to="/login" className="btn btn-ghost">Sign in</Link>
            </>
          )}
        </nav>
      </header>
      <main className="main">
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
