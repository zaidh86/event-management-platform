import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteEvent, updateEvent, uploadEventMedia } from '../../lib/api'
import { useEvent } from './EventLayout'
import type { EmpEvent, EventStatus, RegistrationField } from '../../lib/types'

export function SettingsPage() {
  const { event, refresh, canManageEvent, isClubAdmin } = useEvent()
  const [form, setForm] = useState({
    name: event.name,
    description: event.description,
    status: event.status,
    is_team_event: event.is_team_event,
    team_size_min: event.team_size_min,
    team_size_max: event.team_size_max,
    currency_name: event.currency_name,
    currency_name_plural: event.currency_name_plural,
    starting_balance: event.starting_balance,
    min_balance: event.min_balance,
    allow_negative: event.allow_negative,
    public_leaderboard: event.public_leaderboard,
    theme_color: event.theme_color,
  })
  const [fields, setFields] = useState<RegistrationField[]>(event.registration_fields)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const cleanFields = fields
        .filter((f) => f.label.trim() !== '')
        .map((f) => ({
          ...f,
          key: f.key || f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          options: f.type === 'select' ? (f.options ?? []).filter((o) => o.trim() !== '') : undefined,
        }))
      await updateEvent(event.id, { ...form, registration_fields: cleanFields })
      await refresh()
      setNotice('Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function upload(kind: 'logo_url' | 'banner_url' | 'currency_image_url', file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const url = await uploadEventMedia(event.id, file, kind.replace('_url', ''))
      await updateEvent(event.id, { [kind]: url })
      await refresh()
      setNotice('Image updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  // the tab is hidden for the unauthorized; this also covers arriving by URL.
  // Configure rights: event organizers, club admins of the event's club, and
  // platform admins — mirroring the events_update RLS policy.
  if (!canManageEvent) {
    return (
      <div className="page">
        <p className="form-error">You don't have permission to configure this event.</p>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <h2>Event settings</h2>
      <form onSubmit={(e) => void onSave(e)} className="stack">
        <section className="card stack">
          <h3>Basics</h3>
          <label>
            Name
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => set('status', e.target.value as EventStatus)}>
              <option value="draft">Draft (hidden, being configured)</option>
              <option value="active">Active (registration & play open)</option>
              <option value="ended">Ended (frozen, results visible)</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox" checked={form.public_leaderboard}
              onChange={(e) => set('public_leaderboard', e.target.checked)}
            />
            Public leaderboard (shareable link, no sign-in needed)
          </label>
          <label>
            Theme color
            <input type="color" value={form.theme_color} onChange={(e) => set('theme_color', e.target.value)} />
          </label>
        </section>

        <section className="card stack">
          <h3>Format</h3>
          <label className="check">
            <input
              type="checkbox" checked={form.is_team_event}
              onChange={(e) => set('is_team_event', e.target.checked)}
            />
            Team event
          </label>
          {form.is_team_event && (
            <div className="row">
              <label>
                Min team size
                <input
                  type="number" min={1} value={form.team_size_min}
                  onChange={(e) => set('team_size_min', Number(e.target.value))}
                />
              </label>
              <label>
                Max team size
                <input
                  type="number" min={form.team_size_min} value={form.team_size_max}
                  onChange={(e) => set('team_size_max', Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </section>

        <section className="card stack">
          <h3>Currency</h3>
          <div className="row">
            <label>
              Name (singular)
              <input value={form.currency_name} onChange={(e) => set('currency_name', e.target.value)} required />
            </label>
            <label>
              Name (plural)
              <input value={form.currency_name_plural} onChange={(e) => set('currency_name_plural', e.target.value)} required />
            </label>
          </div>
          <div className="row">
            <label>
              Starting balance
              <input
                type="number" step="any" value={form.starting_balance}
                onChange={(e) => set('starting_balance', Number(e.target.value))}
              />
            </label>
            <label>
              Minimum balance
              <input
                type="number" step="any" value={form.min_balance}
                onChange={(e) => set('min_balance', Number(e.target.value))}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox" checked={form.allow_negative}
              onChange={(e) => set('allow_negative', e.target.checked)}
            />
            Allow negative balances (minimum balance may be below zero)
          </label>
          <div className="media-row">
            <img src={event.currency_image_url ?? '/currency-default.svg'} alt="" className="currency-img-lg" />
            <label className="btn btn-ghost btn-sm file-btn">
              Replace currency image
              <input
                type="file" accept="image/*" hidden
                onChange={(e) => void upload('currency_image_url', e.target.files?.[0])}
              />
            </label>
          </div>
        </section>

        <section className="card stack">
          <h3>Branding</h3>
          <div className="media-row">
            {event.logo_url && <img src={event.logo_url} alt="" className="event-logo" />}
            <label className="btn btn-ghost btn-sm file-btn">
              Upload logo
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('logo_url', e.target.files?.[0])} />
            </label>
            <label className="btn btn-ghost btn-sm file-btn">
              Upload banner
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('banner_url', e.target.files?.[0])} />
            </label>
          </div>
          {event.banner_url && <img src={event.banner_url} alt="" className="event-banner" />}
        </section>

        <section className="card stack">
          <h3>Registration fields</h3>
          <p className="muted">Extra questions participants answer when registering.</p>
          {fields.map((f, i) => (
            <div className="field-row" key={i}>
              <input
                placeholder="Label" value={f.label}
                onChange={(e) => setFields((fs) => fs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
              />
              <select
                value={f.type}
                onChange={(e) => setFields((fs) => fs.map((x, j) => j === i ? { ...x, type: e.target.value as RegistrationField['type'] } : x))}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="select">Choice</option>
              </select>
              {f.type === 'select' && (
                <input
                  placeholder="Options, comma-separated"
                  value={(f.options ?? []).join(',')}
                  onChange={(e) => setFields((fs) => fs.map((x, j) => j === i ? { ...x, options: e.target.value.split(',') } : x))}
                />
              )}
              <label className="check">
                <input
                  type="checkbox" checked={f.required}
                  onChange={(e) => setFields((fs) => fs.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                />
                Required
              </label>
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button" className="btn btn-ghost btn-sm"
            onClick={() => setFields((fs) => [...fs, { key: '', label: '', type: 'text', required: false }])}
          >
            + Add field
          </button>
        </section>

        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-notice">{notice}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </form>

      {/* Outside the settings form on purpose: nesting forms is invalid markup and
          would let a stray Enter key submit the wrong one. Deletion is club-management
          authority: platform admins, or club admins of this event's club — mirroring
          the events_delete RLS policy. Plain organizers configure but never delete. */}
      {isClubAdmin && <DangerZone event={event} />}
    </div>
  )
}

function DangerZone({ event }: { event: EmpEvent }) {
  const navigate = useNavigate()
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmed = confirmName.trim() === event.name.trim()

  async function onDelete() {
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteEvent(event.id)
      navigate(event.club_id ? `/clubs/${event.club_id}/events` : '/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event')
      setBusy(false)
    }
  }

  return (
    <section className="card danger-zone stack">
      <h3>Danger zone</h3>
      <p className="muted">
        Deleting <strong>{event.name}</strong> is permanent and cannot be undone.
        Its participants, teams, activities, announcements and the entire points
        ledger — every account balance and transaction — are deleted with it.
      </p>
      <label>
        Type <strong>{event.name}</strong> to confirm
        <input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={event.name}
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
        {busy ? 'Deleting…' : 'Delete event permanently'}
      </button>
    </section>
  )
}
