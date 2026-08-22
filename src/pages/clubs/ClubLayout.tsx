import { Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom'
import { getClub, listMyClubMemberships } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { clubRoleLabel, isClubAuthority, platformRoleLabel } from '../../lib/roles'
import type { Club, ClubRole } from '../../lib/types'

export interface ClubContext {
  club: Club
  myClubRole: ClubRole | null
  // holds club authority here — club_admin or convener (isClubAuthority) — or is
  // a platform admin (super admin / platform owner via isSuperAdmin, no
  // club_members row needed). Mirrors is_club_admin() in SQL exactly.
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
    if (!clubId) return
    try {
      // public-first: the club itself loads for signed-out visitors too
      const [c, memberships] = await Promise.all([
        getClub(clubId),
        session ? listMyClubMemberships(session.user.id) : Promise.resolve([]),
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

  const canManage = isSuperAdmin || isClubAuthority(myClubRole)
  const isMember = canManage || myClubRole !== null
  const ctx: ClubContext = { club, myClubRole, canManage, refresh }

  return (
    <div className="event-shell">
      <p className="breadcrumb"><Link to="/">← Home</Link></p>
      <div className="event-header">
        {club.logo_url && <img src={club.logo_url} alt="" className="event-logo" />}
        <div>
          <h1>{club.name}</h1>
          {club.department && <p className="club-dept">{club.department}</p>}
          {clubRoleLabel(myClubRole) && <span className="badge">{clubRoleLabel(myClubRole)}</span>}
          {/* a platform admin holding a POWERLESS club role (faculty/member)
              still shows their platform standing — the club badge would
              otherwise imply their authority here comes from the club */}
          {isSuperAdmin && !isClubAuthority(myClubRole) && (
            <span className="badge badge-admin">{platformRoleLabel(profile?.role)}</span>
          )}
          {club.description && <p className="club-blurb">{club.description}</p>}
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
