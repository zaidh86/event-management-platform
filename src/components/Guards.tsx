import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  // When this guard is nested inside a layout route (e.g. ClubLayout →
  // RequireAuth → ClubSettingsPage), useOutletContext resolves against the
  // NEAREST Outlet — this one. Forward the parent layout's context so guarded
  // children still receive it; without this, useClub()/useEvent() under a
  // nested guard return undefined and the page crashes.
  const parentContext = useOutletContext()
  if (loading) return <div className="page-loading">Loading…</div>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <Outlet context={parentContext} />
}
