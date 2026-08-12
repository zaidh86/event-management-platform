import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  createTeam, getAccountFor, getTeam, joinTeam, listAccountTransactions,
  listTeamMembers, listTeams, registerForEvent,
} from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { fmtDateTime, fmtPoints, fmtSigned } from '../../lib/format'
import { QRCard } from '../../components/QRCard'
import { useEvent } from './EventLayout'
import type { Account, Participant, Team, Transaction } from '../../lib/types'

export function DashboardPage() {
  const { event, participant, refresh } = useEvent()
  if (!participant) return <RegisterForm />
  return <ParticipantDashboard key={participant.id} participant={participant} refreshEvent={refresh} eventId={event.id} />
}

// ---- registration ----------------------------------------------------------

function RegisterForm() {
  const { event, refresh } = useEvent()
  const [displayName, setDisplayName] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (event.status !== 'active') {
    return (
      <div className="page">
        <p className="muted">
          Registration is not open — the event is {event.status}.
        </p>
      </div>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data: Record<string, unknown> = {}
      for (const f of event.registration_fields) {
        const raw = fields[f.key] ?? ''
        if (f.required && raw.trim() === '') throw new Error(`${f.label} is required`)
        data[f.key] = f.type === 'number' ? Number(raw || 0) : raw
      }
      await registerForEvent(event.id, displayName, data)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      setBusy(false)
    }
  }

  return (
    <div className="page page-narrow">
      <h2>Register for {event.name}</h2>
      <form onSubmit={(e) => void onSubmit(e)} className="stack card">
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={60} />
        </label>
        {event.registration_fields.map((f) => (
          <label key={f.key}>
            {f.label}{f.required && ' *'}
            {f.type === 'select' ? (
              <select
                value={fields[f.key] ?? ''}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                required={f.required}
              >
                <option value="">Select…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                value={fields[f.key] ?? ''}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                required={f.required}
              />
            )}
          </label>
        ))}
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
      </form>
    </div>
  )
}

// ---- dashboard -------------------------------------------------------------

function ParticipantDashboard({ participant, refreshEvent, eventId }: {
  participant: Participant
  refreshEvent: () => Promise<void>
  eventId: string
}) {
  const { event } = useEvent()
  const [account, setAccount] = useState<Account | null>(null)
  const [team, setTeam] = useState<Team | null>(null)
  const [teammates, setTeammates] = useState<Participant[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])

  const load = useCallback(async () => {
    let acc: Account | null = null
    if (event.is_team_event) {
      if (participant.team_id) {
        const [t, members] = await Promise.all([
          getTeam(participant.team_id),
          listTeamMembers(participant.team_id),
        ])
        setTeam(t)
        setTeammates(members)
        acc = (await getAccountFor('team', participant.team_id)) as Account | null
      }
    } else {
      acc = (await getAccountFor('participant', participant.id)) as Account | null
    }
    setAccount(acc)
    if (acc) setTransactions(await listAccountTransactions(acc.id))
  }, [event.is_team_event, participant.team_id, participant.id])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  // live balance + ledger updates for my account
  useEffect(() => {
    if (!account) return
    const channel = supabase
      .channel(`account-${account.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'accounts', filter: `id=eq.${account.id}` },
        (payload) => setAccount(payload.new as Account),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transactions', filter: `account_id=eq.${account.id}` },
        (payload) => setTransactions((prev) => [payload.new as Transaction, ...prev]),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [account?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsTeam = event.is_team_event && !participant.team_id

  return (
    <div className="page">
      <div className="dash-grid">
        <section className="card balance-card">
          <h2>{event.is_team_event ? 'Team balance' : 'My balance'}</h2>
          {account ? (
            <div className="balance-big">
              <img src={event.currency_image_url ?? '/currency-default.svg'} alt="" className="currency-img-lg" />
              <span>{fmtPoints(event, account.balance)}</span>
            </div>
          ) : (
            <p className="muted">{needsTeam ? 'Join a team to get a balance.' : 'No account yet.'}</p>
          )}
        </section>

        {event.is_team_event ? (
          needsTeam
            ? <TeamPicker eventId={eventId} onDone={refreshEvent} />
            : (
              <section className="card">
                <h2>Team: {team?.name}</h2>
                <ul className="member-list">
                  {teammates.map((m) => (
                    <li key={m.id}>{m.display_name}{m.id === participant.id && ' (you)'}</li>
                  ))}
                </ul>
                {team && <QRCard token={team.qr_token} label={`Team QR — ${team.name}`} />}
              </section>
            )
        ) : (
          <section className="card">
            <h2>My QR code</h2>
            <p className="muted">Show this at activity stations.</p>
            <QRCard token={participant.qr_token} label={participant.display_name} />
          </section>
        )}

        {event.is_team_event && !needsTeam && (
          <section className="card">
            <h2>My QR code</h2>
            <p className="muted">Scans of your personal QR credit your team.</p>
            <QRCard token={participant.qr_token} label={participant.display_name} />
          </section>
        )}

        <section className="card tx-card">
          <h2>Transactions</h2>
          {transactions.length === 0 && <p className="muted">No transactions yet.</p>}
          <ul className="tx-list">
            {transactions.map((tx) => (
              <li key={tx.id}>
                <span className={`tx-amount ${tx.amount >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(event, tx.amount)}</span>
                <span className="tx-desc">{tx.description || tx.type.replace('_', ' ')}</span>
                <span className="muted">{fmtDateTime(tx.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function TeamPicker({ eventId, onDone }: { eventId: string; onDone: () => Promise<void> }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listTeams(eventId).then(setTeams).catch(() => {})
  }, [eventId])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Join or create a team</h2>
      <form
        className="row team-create"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => createTeam(eventId, name))
        }}
      >
        <input placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn btn-primary" disabled={busy}>Create</button>
      </form>
      {teams.length > 0 && (
        <>
          <h3>Existing teams</h3>
          <ul className="team-list">
            {teams.map((t) => (
              <li key={t.id}>
                <span>{t.name}</span>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => joinTeam(t.id))}>
                  Join
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
