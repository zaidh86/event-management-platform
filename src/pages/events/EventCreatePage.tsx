import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createEvent } from '../../lib/api'

export function EventCreatePage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isTeamEvent, setIsTeamEvent] = useState(false)
  const [teamMin, setTeamMin] = useState(2)
  const [teamMax, setTeamMax] = useState(4)
  const [currency, setCurrency] = useState('Point')
  const [currencyPlural, setCurrencyPlural] = useState('Points')
  const [startingBalance, setStartingBalance] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const ev = await createEvent({
        name,
        description,
        is_team_event: isTeamEvent,
        team_size_min: isTeamEvent ? teamMin : 1,
        team_size_max: isTeamEvent ? teamMax : 1,
        currency_name: currency || 'Point',
        currency_name_plural: currencyPlural || currency + 's',
        starting_balance: startingBalance,
      })
      navigate(`/events/${ev.id}/settings`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event')
      setBusy(false)
    }
  }

  return (
    <div className="page page-narrow">
      <h1>Create event</h1>
      <p className="muted">
        Starts as a draft. Configure everything (currency image, branding, registration
        fields, activities) in settings, then set it to Active to open registration.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="stack card">
        <label>
          Event name
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Cyber Casino" />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <label className="check">
          <input type="checkbox" checked={isTeamEvent} onChange={(e) => setIsTeamEvent(e.target.checked)} />
          Team event
        </label>
        {isTeamEvent && (
          <div className="row">
            <label>
              Min team size
              <input type="number" min={1} value={teamMin} onChange={(e) => setTeamMin(Number(e.target.value))} />
            </label>
            <label>
              Max team size
              <input type="number" min={teamMin} value={teamMax} onChange={(e) => setTeamMax(Number(e.target.value))} />
            </label>
          </div>
        )}
        <div className="row">
          <label>
            Currency name (singular)
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="Chip" />
          </label>
          <label>
            Currency name (plural)
            <input value={currencyPlural} onChange={(e) => setCurrencyPlural(e.target.value)} placeholder="Chips" />
          </label>
        </div>
        <label>
          Starting balance
          <input type="number" value={startingBalance} onChange={(e) => setStartingBalance(Number(e.target.value))} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button>
      </form>
    </div>
  )
}
