import { useCallback, useEffect, useState } from 'react'
import { Crown, ShieldCheck, Star, StarOff, UserPlus } from 'lucide-react'
import {
  listMyEvents, listPlatformAdmins, searchProfiles, setEventFeatured,
  setGlobalRole, transferPlatformOwnership,
} from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { platformRoleLabel } from '../../lib/roles'
import type { EmpEvent, Profile } from '../../lib/types'

// Platform administration (/admin): administrators, ownership, featured events.
// Every action here is enforced server-side (protect_profile_role,
// protect_event_featured, transfer_platform_ownership) — this page only
// surfaces controls to the roles the database will actually allow (ADR-0010).
export function PlatformAdminPage() {
  const { isSuperAdmin, isOwner } = useAuth()

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <p className="form-error">Only platform administrators can open platform settings.</p>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <h1>Platform settings</h1>
      <p className="muted">
        Platform-wide administration — separate from personal, club and event
        settings.
      </p>
      <AdminsSection canManage={isOwner} />
      {isOwner && <OwnershipSection />}
      <FeaturedSection />
    </div>
  )
}

// ---- administrators ----------------------------------------------------------

function AdminsSection({ canManage }: { canManage: boolean }) {
  const toast = useToast()
  const [admins, setAdmins] = useState<Profile[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [confirmRevoke, setConfirmRevoke] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    listPlatformAdmins().then(setAdmins).catch(() => setAdmins([]))
  }, [])
  useEffect(() => { reload() }, [reload])

  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    try {
      const found = await searchProfiles(q)
      setResults(found.filter((p) => p.role === 'user'))
    } catch {
      setResults([])
    }
  }

  async function grant(p: Profile) {
    setBusy(true)
    try {
      await setGlobalRole(p.id, 'super_admin')
      toast('success', `${p.email} is now a Super Admin`)
      setQuery('')
      setResults([])
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Grant failed')
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!confirmRevoke) return
    setBusy(true)
    try {
      await setGlobalRole(confirmRevoke.id, 'user')
      toast('success', `Super Admin removed from ${confirmRevoke.email}`)
      setConfirmRevoke(null)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Revoke failed')
      setConfirmRevoke(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <h2>Administrators</h2>
      {admins === null && <Skeleton lines={2} height="2.4rem" />}
      {admins !== null && (
        <ul className="admin-list">
          {admins.map((p) => (
            <li key={p.id}>
              <span className="admin-list-who">
                {p.role === 'platform_owner'
                  ? <Crown size={16} aria-hidden className="admin-owner-icon" />
                  : <ShieldCheck size={16} aria-hidden />}
                <span>
                  <strong>{p.full_name || p.email}</strong>
                  {p.full_name && <span className="muted"> · {p.email}</span>}
                </span>
                <span className="badge badge-admin">{platformRoleLabel(p.role)}</span>
              </span>
              {/* the owner row is untouchable (protect_profile_role); the UI
                  mirrors that instead of offering a control that must fail */}
              {canManage && p.role === 'super_admin' && (
                <button
                  className="btn btn-ghost btn-sm" disabled={busy}
                  onClick={() => setConfirmRevoke(p)}
                >
                  Remove Super Admin
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="stack">
          <label>
            Grant Super Admin
            <input
              placeholder="Search by email or name…"
              value={query}
              onChange={(e) => void search(e.target.value)}
            />
          </label>
          {results.length > 0 && (
            <ul className="admin-list">
              {results.map((p) => (
                <li key={p.id}>
                  <span className="admin-list-who">
                    <span>
                      <strong>{p.full_name || p.email}</strong>
                      {p.full_name && <span className="muted"> · {p.email}</span>}
                    </span>
                  </span>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void grant(p)}>
                    <UserPlus size={14} aria-hidden /> Make Super Admin
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <p className="muted">No matching ordinary-user accounts.</p>
          )}
        </div>
      )}
      {!canManage && (
        <p className="muted">Only the Platform Owner grants or removes Super Admins here.</p>
      )}

      <ConfirmDialog
        open={confirmRevoke !== null}
        title={`Remove Super Admin from ${confirmRevoke?.email ?? ''}?`}
        confirmLabel="Remove Super Admin"
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setConfirmRevoke(null)}
      >
        <p className="muted">
          They become an ordinary user and lose all platform administration
          access. Club and event roles are not affected.
        </p>
      </ConfirmDialog>
    </section>
  )
}

// ---- ownership ---------------------------------------------------------------

function OwnershipSection() {
  const { session, refreshProfile } = useAuth()
  const toast = useToast()
  const [admins, setAdmins] = useState<Profile[]>([])
  const [targetId, setTargetId] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listPlatformAdmins()
      .then((all) => setAdmins(all.filter((p) => p.role === 'super_admin')))
      .catch(() => {})
  }, [])

  const target = admins.find((p) => p.id === targetId) ?? null
  const emailConfirmed = target !== null && confirmEmail.trim().toLowerCase() === target.email.toLowerCase()

  async function doTransfer() {
    if (!target || !emailConfirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await transferPlatformOwnership(target.id)
      await refreshProfile()
      toast('success', `Platform ownership transferred to ${target.email}. You are now a Super Admin.`)
      setConfirmOpen(false)
      setTargetId('')
      setConfirmEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed')
      setConfirmOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack danger-zone">
      <h2>Ownership</h2>
      <p className="muted">
        Transfer Platform Owner authority to another administrator. This is
        permanent from this account's point of view: you become a Super Admin
        and only the new owner can transfer ownership back. The platform always
        has exactly one owner.
      </p>
      {admins.length === 0 ? (
        <p className="muted">
          No eligible administrators. Grant Super Admin to the intended new
          owner first — ownership is handed to an existing administrator, not
          to an arbitrary account.
        </p>
      ) : (
        <>
          <label>
            New owner
            <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setConfirmEmail('') }}>
              <option value="">Select a Super Admin…</option>
              {admins.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ? `${p.full_name} — ${p.email}` : p.email}</option>
              ))}
            </select>
          </label>
          {target && (
            <label>
              Type <strong>{target.email}</strong> to confirm
              <input
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={target.email}
                autoComplete="off"
              />
            </label>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="row">
            <button
              type="button" className="btn btn-danger"
              disabled={!emailConfirmed || busy}
              onClick={() => setConfirmOpen(true)}
            >
              Transfer ownership…
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Transfer platform ownership to ${target?.email ?? ''}?`}
        confirmLabel="Transfer ownership"
        busy={busy}
        onConfirm={() => void doTransfer()}
        onCancel={() => setConfirmOpen(false)}
      >
        <p className="muted">
          <strong>{target?.full_name || target?.email}</strong> becomes the
          Platform Owner. Your account ({session?.user.email}) becomes a Super
          Admin. This happens atomically — the platform never has zero or two
          owners.
        </p>
      </ConfirmDialog>
    </section>
  )
}

// ---- featured events ---------------------------------------------------------

function FeaturedSection() {
  const toast = useToast()
  const [events, setEvents] = useState<EmpEvent[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(() => {
    // platform admins see all events via events_select_auth; drafts are
    // listed too so an upcoming event can be pre-featured deliberately
    listMyEvents().then(setEvents).catch(() => setEvents([]))
  }, [])
  useEffect(() => { reload() }, [reload])

  async function toggle(ev: EmpEvent) {
    setBusyId(ev.id)
    try {
      await setEventFeatured(ev.id, !ev.is_featured)
      toast('success', ev.is_featured ? `"${ev.name}" unfeatured` : `"${ev.name}" is now featured`)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const sorted = (events ?? []).slice().sort((a, b) =>
    Number(b.is_featured) - Number(a.is_featured) || a.name.localeCompare(b.name))

  return (
    <section className="card stack">
      <h2>Featured events</h2>
      <p className="muted">
        Featured events appear in the Home page spotlight. Only platform
        administrators can feature or unfeature an event; draft events stay
        hidden from ordinary users until activated.
      </p>
      {events === null && <Skeleton lines={3} height="2.2rem" />}
      {events !== null && events.length === 0 && (
        <EmptyState icon={Star} title="No events on the platform yet" />
      )}
      {sorted.length > 0 && (
        <ul className="admin-list">
          {sorted.map((ev) => (
            <li key={ev.id}>
              <span className="admin-list-who">
                {ev.is_featured && <Star size={16} aria-hidden className="featured-star" />}
                <span>
                  <strong>{ev.name}</strong>
                  <span className="muted"> · {ev.status}</span>
                </span>
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busyId === ev.id}
                onClick={() => void toggle(ev)}
              >
                {ev.is_featured
                  ? <><StarOff size={14} aria-hidden /> Unfeature</>
                  : <><Star size={14} aria-hidden /> Feature</>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
