import { Link, Outlet, useNavigate } from 'react-router-dom'
import { Suspense } from 'react'
import { Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { platformRoleLabel } from '../lib/roles'

// Theme selection lives in Settings → Appearance (single source of control);
// the old topbar toggle was removed as a duplicate.

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
            <Link to="/login" className="btn btn-ghost">Sign in</Link>
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
