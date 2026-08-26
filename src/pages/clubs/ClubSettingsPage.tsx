import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteClub, removeEventMedia, updateClub, uploadClubMedia } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { useClub } from './ClubLayout'
import type { Club } from '../../lib/types'

export function ClubSettingsPage() {
  const { club, canManage, refresh } = useClub()
  const { isSuperAdmin } = useAuth()
  const [name, setName] = useState(club.name)
  const [department, setDepartment] = useState(club.department ?? '')
  const [description, setDescription] = useState(club.description)
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // branding removal: which image the confirmation dialog is about
  const [confirmRemoveImage, setConfirmRemoveImage] = useState<'logo_url' | 'banner_url' | null>(null)
  const [removingImage, setRemovingImage] = useState(false)

  if (!canManage) {
    return <div className="page"><p className="form-error">You don't have permission to manage this club.</p></div>
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updateClub(club.id, { name, department, description })
      await refresh()
      toast('success', 'Settings saved')
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
      toast('success', 'Image updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  // Clears the club's reference to the image and deletes the stored file.
  // Only the uploader may delete the object (00001 storage policy), so a
  // refused delete still clears the reference and says so.
  async function removeImage(kind: 'logo_url' | 'banner_url') {
    if (removingImage) return
    const label = kind === 'logo_url' ? 'Logo' : 'Banner'
    const current = club[kind]
    setRemovingImage(true)
    setError(null)
    try {
      const fileDeleted = current ? await removeEventMedia(current) : true
      await updateClub(club.id, { [kind]: null })
      await refresh()
      setConfirmRemoveImage(null)
      toast('success', fileDeleted
        ? `${label} removed`
        : `${label} removed — the stored file was kept (only the person who uploaded it can delete it)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not remove the ${label.toLowerCase()}`)
    } finally {
      setRemovingImage(false)
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
          <label>
            Department
            <input
              value={department} onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Department of Computer Science"
            />
          </label>
          <p className="muted">Club link: <code>/clubs/{club.id}</code> · slug: <code>{club.slug}</code></p>
        </section>

        <section className="card stack">
          <h3>Branding</h3>
          <div className="media-row">
            {club.logo_url && <img src={club.logo_url} alt="" className="event-logo" />}
            <label className="btn btn-ghost btn-sm file-btn">
              {club.logo_url ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('logo_url', e.target.files?.[0])} />
            </label>
            {club.logo_url && (
              <button
                type="button" className="btn btn-ghost btn-sm" disabled={removingImage}
                onClick={() => setConfirmRemoveImage('logo_url')}
              >
                Remove logo
              </button>
            )}
            <label className="btn btn-ghost btn-sm file-btn">
              {club.banner_url ? 'Replace banner' : 'Upload banner'}
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('banner_url', e.target.files?.[0])} />
            </label>
            {club.banner_url && (
              <button
                type="button" className="btn btn-ghost btn-sm" disabled={removingImage}
                onClick={() => setConfirmRemoveImage('banner_url')}
              >
                Remove banner
              </button>
            )}
          </div>
          {club.banner_url && <img src={club.banner_url} alt="" className="event-banner" />}
        </section>

        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </form>

      {/* Outside the settings form on purpose: nesting forms is invalid markup and
          would let a stray Enter key submit the wrong one. Platform admins only —
          club admins manage their club but cannot delete it (clubs_delete RLS
          policy admits is_super_admin() alone, migration 00010). */}
      {isSuperAdmin && <ClubDangerZone club={club} />}

      <ConfirmDialog
        open={confirmRemoveImage !== null}
        title={`Remove ${confirmRemoveImage === 'logo_url' ? 'logo' : 'banner'}?`}
        confirmLabel="Remove"
        busy={removingImage}
        onConfirm={() => { if (confirmRemoveImage) void removeImage(confirmRemoveImage) }}
        onCancel={() => setConfirmRemoveImage(null)}
      >
        <p className="muted">
          The image is deleted from storage and this club stops using it. Every
          other club setting is untouched, and you can upload a new one at any time.
        </p>
      </ConfirmDialog>
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
