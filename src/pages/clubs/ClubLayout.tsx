import { Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { getClub, listMyClubMemberships } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { clubRoleLabel, platformRoleLabel } from '../../lib/roles'
import type { Club, ClubRole } from '../../lib/types'

export interface ClubContext {
  club: Club
  myClubRole: ClubRole | null
  // club_admin of this club, or platform admin (super admin / platform owner via
  // isSuperAdmin — no club_members row needed, mirroring is_club_admin() in SQL)
  canManage: boolean
  refresh: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useClub(): ClubContext {
  return useOutletContext<ClubContext>()
}

export function ClubLayout() {
  const { clubId } = useParams<{ clubId: string }>()
  const { session, isSuperAdmin, profile } = useAuth()
  const [club, setClub] = useState<Club | null>(null)
  const [myClubRole, setMyClubRole] = useState<ClubRole | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    if (!clubId || !session) return
    try {
      const [c, memberships] = await Promise.all([
        getClub(clubId),
        listMyClubMemberships(session.user.id),
      ])
      if (!c) {
        setError('Club not found.')
        return
      }
      setClub(c)
      setMyClubRole(memberships.find((m) => m.club_id === clubId)?.role ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load club')
    } finally {
      setLoaded(true)
    }
  }, [clubId, session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // keep a way out: this branch also renders after a club is deleted and the
  // browser's back button returns to its route
  if (error) {
    return (
      <div className="page">
        <p className="breadcrumb"><Link to="/">← Home</Link></p>
        <p className="form-error">{error}</p>
      </div>
    )
  }
  if (!loaded || !club) return <div className="page-loading">Loading club…</div>

  const canManage = isSuperAdmin || myClubRole === 'club_admin'
  const isMember = canManage || myClubRole !== null
  const ctx: ClubContext = { club, myClubRole, canManage, refresh }

  return (
    <div className="event-shell">
      <p className="breadcrumb"><Link to="/">← Home</Link></p>
      <div className="event-header">
        {club.logo_url && <img src={club.logo_url} alt="" className="event-logo" />}
        <div>
          <h1>{club.name}</h1>
          {clubRoleLabel(myClubRole) && <span className="badge">{clubRoleLabel(myClubRole)}</span>}
          {isSuperAdmin && !clubRoleLabel(myClubRole) && (
            <span className="badge badge-admin">{platformRoleLabel(profile?.role)}</span>
          )}
        </div>
      </div>
      <nav className="event-tabs">
        <NavLink to="" end>Overview</NavLink>
        <NavLink to="events">Events</NavLink>
        {isMember && <NavLink to="members">Members</NavLink>}
        {canManage && <NavLink to="settings">Settings</NavLink>}
      </nav>
      <Suspense fallback={<div className="page-loading">Loading…</div>}>
        <Outlet context={ctx} />
      </Suspense>
    </div>
  )
}
