import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { Award, CheckCircle2, FileText, MessageSquare, Paperclip, User, UsersRound, Wallet } from 'lucide-react'
import {
  createTeam, getAccountFor, getMyAttendance, getMySubmission,
  getSubmissionDocumentUrl, getTeam, joinTeam, listAccountTransactions,
  listCertificates, listFeedbackForms, listQrConfigs, listTeamMembers,
  listTeams, registerForEvent, removeSubmissionDocument, saveSubmission,
  uploadSubmissionDocument,
} from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { fmtDateTime, fmtPoints, fmtSigned } from '../../lib/format'
import { myQrConfigs } from '../../lib/qr'
import { deadlinePassed } from '../../lib/submissions'
import { QRCard } from '../../components/QRCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatTile } from '../../components/ui/StatTile'
import { useEvent } from './EventLayout'
import type {
  Account, AttendanceRecord, Certificate, EmpEvent, FeedbackForm, Participant,
  ParticipationMode, QrConfig, Submission, Team, Transaction,
} from '../../lib/types'

export function DashboardPage() {
  const { event, participant, refresh } = useEvent()
  if (!participant) return <RegisterFlow />
  return <ParticipantDashboard key={participant.id} participant={participant} refreshEvent={refresh} eventId={event.id} />
}

// ---- registration (two steps: custom fields, then participation mode) -------

function RegisterFlow() {
  const { event, refresh } = useEvent()
  const { session } = useAuth()
  const location = useLocation()
  const availableSolo = event.capabilities.solo
  const availableTeam = event.capabilities.teams
  const singleMode: ParticipationMode | null =
    availableSolo && availableTeam ? null : availableSolo ? 'solo' : availableTeam ? 'team' : null

  const [step, setStep] = useState<1 | 2>(1)
  const [displayName, setDisplayName] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  // single-mode events arrive at step 2 with the only option preselected —
  // the choice is still explicit and explicitly persisted
  const [mode, setMode] = useState<ParticipationMode | null>(singleMode)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (event.status !== 'active') {
    return (
      <div className="page">
        <p className="muted">Registration is not open — the event is {event.status}.</p>
      </div>
    )
  }
  // public-first: browsing never forces authentication — the moment someone
  // decides to participate is when an account becomes necessary
  if (!session) {
    return (
      <div className="page page-narrow">
        <div className="card stack register-cta">
          <h2>Join {event.name}</h2>
          <p className="muted">
            Registration takes a minute — you need an EMP account so the event
            can recognise you at check-ins, scoring and results.
          </p>
          <div className="row">
            <Link to="/login" state={{ from: location.pathname }} className="btn btn-primary">
              Register / Join event
            </Link>
          </div>
        </div>
      </div>
    )
  }
  if (!availableSolo && !availableTeam) {
    return (
      <div className="page">
        <p className="muted">This event is not accepting participants.</p>
      </div>
    )
  }

  // step 1 submit: native validation has passed; EMP-level required check too
  function onFieldsNext(e: FormEvent) {
    e.preventDefault()
    setError(null)
    for (const f of event.registration_fields) {
      const raw = fields[f.key] ?? ''
      if (f.required && raw.trim() === '') {
        setError(`${f.label} is required`)
        return
      }
    }
    setStep(2)
  }

  async function onRegister() {
    if (!mode || busy) return
    setBusy(true)
    setError(null)
    try {
      const data: Record<string, unknown> = {}
      for (const f of event.registration_fields) {
        const raw = fields[f.key] ?? ''
        data[f.key] = f.type === 'number' ? Number(raw || 0) : raw
      }
      await registerForEvent(event.id, displayName, data, mode)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      setBusy(false)
    }
  }

  if (step === 1) {
    return (
      <div className="page page-narrow">
        <p className="step-kicker">Registration · step 1 of 2</p>
        <h2>Register for {event.name}</h2>
        <form onSubmit={onFieldsNext} className="stack card">
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
          <button className="btn btn-primary">Next</button>
        </form>
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <p className="step-kicker">Registration · step 2 of 2</p>
      <h2>How would you like to participate?</h2>
      <div className="mode-grid">
        {availableSolo && (
          <button
            type="button"
            className="mode-card"
            aria-pressed={mode === 'solo'}
            onClick={() => setMode('solo')}
            disabled={busy}
          >
            <span className="mode-card-title"><User size={18} aria-hidden /> Solo participant</span>
            <p>Participate individually, with your own {event.capabilities.points ? 'balance and ' : ''}dashboard.</p>
          </button>
        )}
        {availableTeam && (
          <button
            type="button"
            className="mode-card"
            aria-pressed={mode === 'team'}
            onClick={() => setMode('team')}
            disabled={busy}
          >
            <span className="mode-card-title"><UsersRound size={18} aria-hidden /> Team participant</span>
            <p>Join or create a team of {event.team_size_min}–{event.team_size_max} and participate together.</p>
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!mode || busy}
          onClick={() => void onRegister()}
        >
          {busy ? 'Registering…' : 'Register'}
        </button>
      </div>
    </div>
  )
}

// ---- dashboard ---------------------------------------------------------------
// The participant's STORED participation_mode is the source of truth here —
// never event.is_team_event and never whether a team happens to exist (ADR-0007).

function ParticipantDashboard({ participant, refreshEvent, eventId }: {
  participant: Participant
  refreshEvent: () => Promise<void>
  eventId: string
}) {
  const { event } = useEvent()
  const isTeamMode = participant.participation_mode === 'team'
  const [account, setAccount] = useState<Account | null>(null)
  const [accountLoaded, setAccountLoaded] = useState(false)
  const [team, setTeam] = useState<Team | null>(null)
  const [teammates, setTeammates] = useState<Participant[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  // universal QR operations (ADR-0009): the cards below are configuration-driven
  const [qrConfigs, setQrConfigs] = useState<QrConfig[] | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null)
  const [feedbackForms, setFeedbackForms] = useState<FeedbackForm[]>([])
  const [certificates, setCertificates] = useState<Certificate[]>([])

  const load = useCallback(async () => {
    let acc: Account | null = null
    if (isTeamMode) {
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
    setAccountLoaded(true)
    if (acc) setTransactions(await listAccountTransactions(acc.id))
  }, [isTeamMode, participant.team_id, participant.id])

  useEffect(() => {
    load().catch(() => setAccountLoaded(true))
  }, [load])

  useEffect(() => {
    listQrConfigs(eventId).then(setQrConfigs).catch(() => setQrConfigs([]))
    if (event.capabilities.attendance) {
      getMyAttendance(eventId, participant.id).then(setAttendance).catch(() => {})
    }
    if (event.capabilities.feedback) {
      listFeedbackForms(eventId)
        .then((forms) => setFeedbackForms(forms.filter((f) => f.status === 'published')))
        .catch(() => {})
    }
    if (event.capabilities.certificates) {
      // RLS returns only the caller's own certificates here
      listCertificates(eventId).then(setCertificates).catch(() => {})
    }
  }, [eventId, participant.id, event.capabilities.attendance, event.capabilities.feedback, event.capabilities.certificates])

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

  const needsTeam = isTeamMode && !participant.team_id

  return (
    <div className="page">
      <div className="dash-grid">
        {event.capabilities.points && (
          <section className="card">
            {!accountLoaded ? (
              <Skeleton lines={2} height="1.6rem" />
            ) : (
              <StatTile label={isTeamMode ? 'Team balance' : 'My balance'} icon={Wallet}>
                {account ? (
                  <>
                    <img src={event.currency_image_url ?? '/currency-default.svg'} alt="" className="currency-img-lg" />
                    <span>{fmtPoints(event, account.balance)}</span>
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 'var(--fs-3)', fontWeight: 400 }}>
                    {needsTeam ? 'Join a team to get a balance.' : 'No balance yet.'}
                  </span>
                )}
              </StatTile>
            )}
          </section>
        )}

        {/* team sections exist ONLY for participants who chose team mode */}
        {isTeamMode && (
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
                {/* team QR moved to the "My QR codes" section below */}
              </section>
            )
        )}

        {event.capabilities.qr && qrConfigs !== null && (() => {
          // configuration-driven cards: one card per applicable QR operation.
          // Zero configured operations = legacy behavior (participant + team QR).
          const mine = myQrConfigs(qrConfigs, isTeamMode, !!team)
          const hasStationConfigs = qrConfigs.some(
            (c) => c.is_enabled && (c.target === 'participant' || c.target === 'team'),
          )
          if (!hasStationConfigs) {
            if (isTeamMode && needsTeam) return null
            return (
              <section className="card">
                <h2>My QR codes</h2>
                <QRCard
                  token={participant.qr_token}
                  label="My event QR"
                  description={isTeamMode
                    ? `Show this to event staff for check-ins, scoring and verification — scans credit your team's balance.`
                    : 'Show this to event staff for check-ins, scoring and verification.'}
                />
                {isTeamMode && team && (
                  <QRCard
                    token={team.qr_token}
                    label={`Team QR — ${team.name}`}
                    description="For team-level operations such as scoring and team verification."
                  />
                )}
              </section>
            )
          }
          if (mine.participant.length === 0 && mine.team.length === 0) return null
          return (
            <section className="card">
              <h2>My QR codes</h2>
              {mine.participant.map((cfg) => (
                <QRCard
                  key={cfg.id}
                  token={participant.qr_token}
                  label={cfg.label}
                  description={cfg.description || undefined}
                />
              ))}
              {team && mine.team.map((cfg) => (
                <QRCard
                  key={cfg.id}
                  token={team.qr_token}
                  label={`${cfg.label} — ${team.name}`}
                  description={cfg.description || undefined}
                />
              ))}
            </section>
          )
        })()}

        {event.capabilities.attendance && (
          <section className="card">
            <h2>Attendance</h2>
            {attendance ? (
              <p className="attendance-ok">
                <CheckCircle2 size={18} aria-hidden /> Checked in — {fmtDateTime(attendance.created_at)}
              </p>
            ) : (
              <p className="muted">Not checked in yet. Show your QR to event staff at check-in.</p>
            )}
          </section>
        )}

        {event.capabilities.submissions && (
          <SubmissionSection event={event} participant={participant} hasTeam={!!team} />
        )}

        {event.capabilities.feedback && feedbackForms.some((f) => (f.kind ?? 'feedback') === 'feedback') && (
          <section className="card">
            <h2>Feedback</h2>
            <ul className="feedback-list">
              {feedbackForms.filter((f) => (f.kind ?? 'feedback') === 'feedback').map((f) => (
                <li key={f.id}>
                  <span><MessageSquare size={16} aria-hidden /> {f.title}</span>
                  <Link className="btn btn-ghost btn-sm" to={`/f/${f.id}`}>Give feedback</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {event.capabilities.feedback && feedbackForms.some((f) => f.kind === 'reflection') && (
          <section className="card">
            <h2>Event Report</h2>
            <p className="muted">
              Share your experience of the event — your report goes to the
              organizers and the event record.
            </p>
            <ul className="feedback-list">
              {feedbackForms.filter((f) => f.kind === 'reflection').map((f) => (
                <li key={f.id}>
                  <span><FileText size={16} aria-hidden /> {f.title}</span>
                  <Link className="btn btn-primary btn-sm" to={`/f/${f.id}`}>Fill event report</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {event.capabilities.certificates && certificates.length > 0 && (
          <section className="card">
            <h2>My certificates</h2>
            <ul className="feedback-list">
              {certificates.map((c) => (
                <li key={c.id}>
                  <span><Award size={16} aria-hidden /> {c.title}{c.detail ? ` — ${c.detail}` : ''}</span>
                  <a className="btn btn-ghost btn-sm" href={`/cert/${c.verify_code}`} target="_blank" rel="noreferrer">
                    View ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {event.capabilities.points && (
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
        )}
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

// ---- submission (ADR-0011) ---------------------------------------------------
// One entry per participant (solo) or per team (shared — every member sees and
// may update the SAME record; the server row is the source of truth). Verified
// lifecycle (00016/00020): drafts AND submitted entries stay editable until
// the deadline passes / the event stops being active — so the UI says
// "you can update", never "you can't submit twice". An optional PDF
// (work/project overview) attaches to the same submission.

export function SubmissionSection({ event, participant, hasTeam }: {
  event: EmpEvent
  participant: Participant
  hasTeam: boolean
}) {
  const cfg = event.submission_config
  const isTeamMode = participant.participation_mode === 'team'
  const closed = deadlinePassed(cfg) || event.status !== 'active'
  const heading = isTeamMode ? 'Team Submission' : 'My Submission'
  const [sub, setSub] = useState<Submission | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getMySubmission(event.id, participant)
      .then((existing) => {
        setSub(existing)
        if (existing) {
          setTitle(existing.title)
          setDescription(existing.description)
          setFields(Object.fromEntries(
            Object.entries(existing.content).map(([k, v]) => [k, String(v)]),
          ))
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [event.id, participant])

  function buildContent(): Record<string, unknown> {
    const content: Record<string, unknown> = {}
    for (const f of cfg.fields) {
      const raw = fields[f.key] ?? ''
      if (raw !== '') content[f.key] = f.type === 'number' ? Number(raw) : raw
    }
    return content
  }

  async function save(submit: boolean) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const content = buildContent()
      let saved: Submission
      if (pendingFile) {
        // ensure the row exists (its id is the storage path), upload the PDF,
        // then record the reference — server validates the canonical path
        const draft = sub ?? await saveSubmission({
          eventId: event.id, title, description, content, submit: false,
        })
        const doc = await uploadSubmissionDocument(event.id, draft.id, pendingFile)
        saved = await saveSubmission({
          eventId: event.id, title, description, content, submit,
          documentPath: doc.path, documentName: doc.name,
        })
        setPendingFile(null)
      } else {
        saved = await saveSubmission({ eventId: event.id, title, description, content, submit })
      }
      setSub(saved)
      setNotice(submit
        ? (saved.document_name ? 'Submitted — including your PDF.' : 'Submitted!')
        : 'Draft saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function viewPdf() {
    if (!sub?.document_path) return
    try {
      const url = await getSubmissionDocumentUrl(sub.document_path)
      window.open(url, '_blank', 'noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the PDF')
    }
  }

  async function removePdf() {
    if (!sub?.document_path || busy) return
    setBusy(true)
    setError(null)
    try {
      await removeSubmissionDocument(sub.document_path)
      const saved = await saveSubmission({
        eventId: event.id, title, description, content: buildContent(),
        submit: false, documentPath: '',
      })
      setSub(saved)
      setNotice('PDF removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the PDF')
    } finally {
      setBusy(false)
    }
  }

  if (isTeamMode && !hasTeam) {
    return (
      <section className="card">
        <h2>Team Submission</h2>
        <p className="muted">Join a team first — your team shares one submission.</p>
      </section>
    )
  }

  return (
    <section className="card stack">
      <div>
        <h2>{heading}</h2>
        <p className="subtle-note">
          {isTeamMode
            ? 'Your team shares one submission — any member can view and update it.'
            : 'Submit your work here'}
        </p>
      </div>
      {cfg.deadline && (
        <p className="muted">
          Deadline: {fmtDateTime(cfg.deadline)}{deadlinePassed(cfg) && ' — closed'}
        </p>
      )}
      {cfg.instructions && <p className="muted">{cfg.instructions}</p>}
      {sub && (
        <p>
          <span className={`badge ${sub.status === 'submitted' ? 'badge-active' : 'badge-draft'}`}>
            {sub.status === 'submitted' ? 'Submitted' : 'Draft'}
          </span>
          {sub.submitted_at && <span className="muted"> {fmtDateTime(sub.submitted_at)}</span>}
          {!closed && sub.status === 'submitted' && (
            <span className="subtle-note">
              {' '}You can update your submission until {cfg.deadline ? fmtDateTime(cfg.deadline) : 'the event ends'}.
            </span>
          )}
        </p>
      )}
      {!loaded ? <Skeleton lines={2} height="2rem" /> : closed ? (
        sub ? (
          <div className="stack">
            <h3>{sub.title}</h3>
            {sub.description && <p>{sub.description}</p>}
            {sub.document_path && (
              <div className="doc-row">
                <span className="doc-name"><Paperclip size={14} aria-hidden /> {sub.document_name}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void viewPdf()}>View</button>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">Submissions are closed.</p>
        )
      ) : (
        <div className="stack">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          </label>
          <label>
            Description
            <textarea
              rows={3} value={description} maxLength={4000}
              className="italic-placeholder" placeholder="Explain your work"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {cfg.fields.map((f) => (
            <label key={f.key}>
              {f.label}{f.required && ' *'}
              {f.type === 'select' ? (
                <select
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                >
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={fields[f.key] ?? ''}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}

          <p className="or-divider" aria-hidden>or</p>
          <div className="doc-row">
            {sub?.document_path && !pendingFile ? (
              <>
                <span className="doc-name"><Paperclip size={14} aria-hidden /> {sub.document_name}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void viewPdf()}>
                  View
                </button>
                <label className="btn btn-ghost btn-sm file-btn">
                  Replace PDF
                  <input
                    type="file" accept="application/pdf,.pdf" hidden
                    onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void removePdf()}>
                  Remove
                </button>
              </>
            ) : (
              <>
                <label className="btn btn-ghost btn-sm file-btn">
                  <Paperclip size={14} aria-hidden /> Upload PDF (optional)
                  <input
                    type="file" accept="application/pdf,.pdf" hidden
                    onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {pendingFile && (
                  <span className="doc-name muted">
                    {pendingFile.name} — uploads when you save
                    <button
                      type="button" className="btn btn-ghost btn-sm"
                      onClick={() => setPendingFile(null)}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
          <p className="subtle-note">
            Explain your work in the description, or attach a PDF with your
            work/project overview — either is fine.
          </p>

          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-notice">{notice}</p>}
          <div className="row">
            <button type="button" className="btn btn-ghost" disabled={busy || !title.trim()} onClick={() => void save(false)}>
              Save draft
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !title.trim()} onClick={() => void save(true)}>
              {busy ? 'Saving…' : sub?.status === 'submitted' ? 'Update submission' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
