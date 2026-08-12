import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="page-loading">Loading…</div>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <Outlet />
}
