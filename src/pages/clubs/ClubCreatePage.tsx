import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClub } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

// Platform admins only (clubs_insert RLS policy: is_super_admin, which the
// platform owner inherits). The UI check is a courtesy; RLS is authoritative.
export function ClubCreatePage() {
  const { isSuperAdmin } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  if (!isSuperAdmin) {
    return <div className="page"><p className="form-error">Only platform administrators can create clubs.</p></div>
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const club = await createClub({ name, description })
      navigate(`/clubs/${club.id}/settings`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create club')
      setBusy(false)
    }
  }

  return (
    <div className="page page-narrow">
      <h1>Create club</h1>
      <p className="muted">
        A club is the home for its events, members and admins. Configure branding
        and add club admins in settings after creating it.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="stack card">
        <label>
          Club name
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Data Science Club" />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create club'}</button>
      </form>
    </div>
  )
}
