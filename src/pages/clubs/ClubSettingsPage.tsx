import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteClub, updateClub, uploadClubMedia } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { useClub } from './ClubLayout'
import type { Club } from '../../lib/types'

export function ClubSettingsPage() {
  const { club, canManage, refresh } = useClub()
  const { isSuperAdmin } = useAuth()
  const [name, setName] = useState(club.name)
  const [description, setDescription] = useState(club.description)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!canManage) {
    return <div className="page"><p className="form-error">You don't have permission to manage this club.</p></div>
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await updateClub(club.id, { name, description })
      await refresh()
      setNotice('Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function upload(kind: 'logo_url' | 'banner_url', file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const url = await uploadClubMedia(club.id, file, kind.replace('_url', ''))
      await updateClub(club.id, { [kind]: url })
      await refresh()
      setNotice('Image updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  return (
    <div className="page page-narrow">
      <h2>Club settings</h2>
      <form onSubmit={(e) => void onSave(e)} className="stack">
        <section className="card stack">
          <h3>Profile</h3>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <p className="muted">Club link: <code>/clubs/{club.id}</code> · slug: <code>{club.slug}</code></p>
        </section>

        <section className="card stack">
          <h3>Branding</h3>
          <div className="media-row">
            {club.logo_url && <img src={club.logo_url} alt="" className="event-logo" />}
            <label className="btn btn-ghost btn-sm file-btn">
              Upload logo
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('logo_url', e.target.files?.[0])} />
            </label>
            <label className="btn btn-ghost btn-sm file-btn">
              Upload banner
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('banner_url', e.target.files?.[0])} />
            </label>
          </div>
          {club.banner_url && <img src={club.banner_url} alt="" className="event-banner" />}
        </section>

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-notice">{notice}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </form>

      {/* Outside the settings form on purpose: nesting forms is invalid markup and
          would let a stray Enter key submit the wrong one. Platform admins only —
          club admins manage their club but cannot delete it (clubs_delete RLS
          policy admits is_super_admin() alone, migration 00010). */}
      {isSuperAdmin && <ClubDangerZone club={club} />}
    </div>
  )
}

function ClubDangerZone({ club }: { club: Club }) {
  const navigate = useNavigate()
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmed = confirmName.trim() === club.name.trim()

  async function onDelete() {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteClub(club.id)
      // replace drops this settings entry; the club route beneath it survives in
      // history and renders ClubLayout's "Club not found" branch, which carries a
      // link home
      navigate('/', { replace: true })
    } catch (err) {
      // stay on the page with the typed confirmation intact so the admin can
      // read the reason (e.g. the club still contains events) and retry
      setError(err instanceof Error ? err.message : 'Failed to delete club')
      setBusy(false)
    }
  }

  return (
    <section className="card danger-zone stack">
      <h3>Danger zone</h3>
      <p className="muted">
        Deleting <strong>{club.name}</strong> is permanent and cannot be undone.
        The club must contain no events — its events are never deleted along with
        it. Club memberships are removed with the club.
      </p>
      <label>
        Type <strong>{club.name}</strong> to confirm
        <input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={club.name}
          autoComplete="off"
          disabled={busy}
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button
        type="button"
        className="btn btn-danger"
        disabled={!confirmed || busy}
        onClick={() => void onDelete()}
      >
        {busy ? 'Deleting…' : 'Delete club permanently'}
      </button>
    </section>
  )
}
