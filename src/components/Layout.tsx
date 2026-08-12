import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

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
              <span className="topbar-user">
                {profile?.full_name || session.user.email}
                {profile?.role === 'super_admin' && <span className="badge badge-admin">super admin</span>}
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
        <Outlet />
      </main>
    </div>
  )
}
