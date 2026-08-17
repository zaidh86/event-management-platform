import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createEvent } from '../../lib/api'
import { useClub } from '../clubs/ClubLayout'
import type { EventCapabilities } from '../../lib/types'

// Club-scoped event creation: the GENERAL configuration layer shared by every
// event type, plus the capability switches that unlock event-specific
// configuration. Rendered inside ClubLayout at /clubs/:clubId/events/new.
export function EventCreatePage() {
  const { club, canManage } = useClub()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isTeamEvent, setIsTeamEvent] = useState(false)
  const [teamMin, setTeamMin] = useState(2)
  const [teamMax, setTeamMax] = useState(4)
  // capabilities — off by default: an event is not a game unless configured as one
  const [capPoints, setCapPoints] = useState(false)
  const [capQr, setCapQr] = useState(false)
  const [capGames, setCapGames] = useState(false)
  const [currency, setCurrency] = useState('Point')
  const [currencyPlural, setCurrencyPlural] = useState('Points')
  const [startingBalance, setStartingBalance] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  if (!canManage) {
    return (
      <div className="page">
        <p className="form-error">You don't have permission to create events in this club.</p>
      </div>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const capabilities: EventCapabilities = {
        teams: isTeamEvent,
        points: capPoints,
        qr: capQr,
        games_api: capPoints && capGames,
        attendance: false,
        submissions: false,
        judging: false,
        deadlines: false,
        feedback: false,
        certificates: false,
      }
      const ev = await createEvent({
        name,
        description,
        club_id: club.id,
        is_team_event: isTeamEvent,
        team_size_min: isTeamEvent ? teamMin : 1,
        team_size_max: isTeamEvent ? teamMax : 1,
        currency_name: currency || 'Point',
        currency_name_plural: currencyPlural || currency + 's',
        starting_balance: capPoints ? startingBalance : 0,
        capabilities,
      })
      navigate(`/events/${ev.id}/settings`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event')
      setBusy(false)
    }
  }

  return (
    <div className="page page-narrow">
      <h2>Create event in {club.name}</h2>
      <p className="muted">
        Starts as a draft. General configuration applies to every event type;
        capabilities unlock event-specific features. Registration fields,
        branding and activities are configured in settings before going active.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <section className="card stack">
          <h3>General configuration</h3>
          <label>
            Event name
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. AI Challenge" />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label className="check">
            <input type="checkbox" checked={isTeamEvent} onChange={(e) => setIsTeamEvent(e.target.checked)} />
            Team event (participants join or create teams)
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
        </section>

        <section className="card stack">
          <h3>Capabilities</h3>
          <p className="muted">Enable only what this event needs — each capability adds its own configuration and tabs.</p>
          <label className="check">
            <input type="checkbox" checked={capPoints} onChange={(e) => setCapPoints(e.target.checked)} />
            Points &amp; live leaderboard (gamified scoring)
          </label>
          {capPoints && (
            <>
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
              <label className="check">
                <input type="checkbox" checked={capGames} onChange={(e) => setCapGames(e.target.checked)} />
                External game integrations (Games API)
              </label>
            </>
          )}
          <label className="check">
            <input type="checkbox" checked={capQr} onChange={(e) => setCapQr(e.target.checked)} />
            QR operations (scan stations, check-in)
          </label>
          <p className="muted">
            More capabilities — submissions &amp; judging, attendance, feedback,
            certificates — arrive in later phases.
          </p>
        </section>

        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button>
      </form>
    </div>
  )
}
