import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  assignEventTables, clearEventTables, createQrConfig, deleteEvent, listEventTables, listParticipants,
  listQrConfigs, listTeams, removeEventMedia, updateEvent, uploadEventMedia,
} from '../../lib/api'
import { formatTable } from '../../lib/tables'
import { QrConfigManager } from '../../components/QrConfigManager'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { useToast } from '../../components/ui/Toast'
import { useEvent } from './EventLayout'
import type {
  EmpEvent, EventStatus, EventTable, LeaderboardEntity, LeaderboardMetric,
  LeaderboardVisibility, RegistrationField,
} from '../../lib/types'

type Participation = 'solo' | 'team' | 'both'

function participationOf(ev: EmpEvent): Participation {
  if (ev.capabilities.solo && ev.capabilities.teams) return 'both'
  if (ev.capabilities.teams) return 'team'
  return 'solo'
}

export function SettingsPage() {
  const { event, refresh, canManageEvent, isClubAdmin } = useEvent()
  const toast = useToast()
  const initialParticipation = participationOf(event)
  const [form, setForm] = useState({
    name: event.name,
    description: event.description,
    status: event.status,
    team_size_min: event.team_size_min,
    team_size_max: event.team_size_max,
    currency_name: event.currency_name,
    currency_name_plural: event.currency_name_plural,
    starting_balance: event.starting_balance,
    min_balance: event.min_balance,
    allow_negative: event.allow_negative,
    theme_color: event.theme_color,
  })
  // capability configuration (editable after creation — ADR-0007)
  const [participation, setParticipation] = useState<Participation>(initialParticipation)
  const [capPoints, setCapPoints] = useState(event.capabilities.points)
  const [capQr, setCapQr] = useState(event.capabilities.qr)
  const [capGames, setCapGames] = useState(event.capabilities.games_api)
  const [capAttendance, setCapAttendance] = useState(event.capabilities.attendance)
  const [capFeedback, setCapFeedback] = useState(event.capabilities.feedback)
  const [capSubmissions, setCapSubmissions] = useState(event.capabilities.submissions)
  const [capJudging, setCapJudging] = useState(event.capabilities.judging)
  const [capCertificates, setCapCertificates] = useState(event.capabilities.certificates)
  // submissions & judging configuration (ADR-0011)
  const sc = event.submission_config
  const [subDeadline, setSubDeadline] = useState(sc.deadline ? sc.deadline.slice(0, 16) : '')
  const [subInstructions, setSubInstructions] = useState(sc.instructions)
  const [subFields, setSubFields] = useState<RegistrationField[]>(sc.fields)
  const [subResults, setSubResults] = useState<'hidden' | 'participants'>(sc.results_visibility)
  const [subAiAssist, setSubAiAssist] = useState(sc.ai_assist)

  // event table allocation (00022)
  const tc = event.table_config
  const [tblEnabled, setTblEnabled] = useState(tc.enabled)
  const [tblStart, setTblStart] = useState(tc.start_number)
  const [tblLabel, setTblLabel] = useState(tc.label)
  // leaderboard configuration (ADR-0008) — event.leaderboard_config is already
  // normalized at the api boundary, so these initial values are always present
  const [lbEnabled, setLbEnabled] = useState(event.leaderboard_config.enabled)
  const [lbEntity, setLbEntity] = useState<LeaderboardEntity>(event.leaderboard_config.entity)
  const [lbMetric, setLbMetric] = useState<LeaderboardMetric>(event.leaderboard_config.metric)
  const [lbVisibility, setLbVisibility] = useState<LeaderboardVisibility>(event.leaderboard_config.visibility)
  const [lbMembers, setLbMembers] = useState(event.leaderboard_config.show_member_count)
  const [fields, setFields] = useState<RegistrationField[]>(event.registration_fields)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmParticipation, setConfirmParticipation] = useState(false)
  // branding removal: which image the confirmation dialog is about
  const [confirmRemoveImage, setConfirmRemoveImage] = useState<'logo_url' | 'banner_url' | null>(null)
  const [removingImage, setRemovingImage] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
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

  async function doSave() {
    setBusy(true)
    setError(null)
    try {
      const soloEnabled = participation !== 'team'
      const teamsEnabled = participation !== 'solo'
      // nonsensical configurations are prevented structurally: the stored entity
      // always matches what participation makes possible (solo-only can never
      // rank teams, team-only can never rank individuals)
      const lbEntityFinal: LeaderboardEntity =
        !teamsEnabled ? 'individuals'
        : !soloEnabled ? 'teams'
        : lbEntity === 'auto' ? 'combined' : lbEntity
      const lbEnabledFinal = capPoints && lbEnabled
      const cleanFields = fields
        .filter((f) => f.label.trim() !== '')
        .map((f) => ({
          ...f,
          key: f.key || f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          options: f.type === 'select' ? (f.options ?? []).filter((o) => o.trim() !== '') : undefined,
        }))
      await updateEvent(event.id, {
        ...form,
        is_team_event: teamsEnabled,
        team_size_min: teamsEnabled ? form.team_size_min : 1,
        team_size_max: teamsEnabled ? form.team_size_max : 1,
        registration_fields: cleanFields,
        // preserve dormant capability keys; write only what this panel manages
        capabilities: {
          ...event.capabilities,
          solo: soloEnabled,
          teams: teamsEnabled,
          points: capPoints,
          qr: capQr,
          games_api: capPoints && capGames,
          attendance: capQr && capAttendance,
          feedback: capFeedback,
          submissions: capSubmissions,
          judging: capSubmissions && capJudging,
          certificates: capCertificates,
        },
        submission_config: {
          deadline: subDeadline ? new Date(subDeadline).toISOString() : null,
          instructions: subInstructions.trim(),
          fields: subFields
            .filter((f) => f.label.trim() !== '')
            .map((f) => ({
              ...f,
              key: f.key || f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
              options: f.type === 'select' ? (f.options ?? []).filter((o) => o.trim() !== '') : undefined,
            })),
          results_visibility: subResults,
          ai_assist: capJudging && subAiAssist,
        },
        table_config: {
          enabled: tblEnabled,
          start_number: Math.max(1, Math.floor(Number(tblStart) || 1)),
          label: tblLabel.trim() || 'Table',
        },
        leaderboard_config: {
          enabled: lbEnabledFinal,
          entity: lbEntityFinal,
          metric: lbMetric,
          visibility: lbVisibility,
          show_member_count: lbMembers,
        },
        // kept in sync so the anon events_select_public RLS arm and the public
        // leaderboard page keep working from the same single source of truth
        public_leaderboard: lbEnabledFinal && lbVisibility === 'public',
      })
      // QA-002: enabling the Attendance capability auto-provisions the
      // participant-facing Attendance QR operation — participants never
      // configure their own QR. Idempotent: skipped if one already exists.
      if (capQr && capAttendance && !event.capabilities.attendance) {
        try {
          const existing = await listQrConfigs(event.id)
          if (!existing.some((c) => c.actions.includes('attendance'))) {
            await createQrConfig({
              event_id: event.id,
              label: 'Attendance QR',
              description: 'Show this QR to event staff at check-in to record your attendance.',
              target: 'participant',
              actions: ['attendance'],
              scanner_access: ['organizer', 'activity_admin', 'volunteer'],
            })
            toast('success', 'Attendance QR operation created automatically')
          }
        } catch { /* non-fatal: manager can add it in QR operations */ }
      }
      await refresh()
      toast('success', 'Settings saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      toast('error', 'Save failed')
    } finally {
      setBusy(false)
      setConfirmParticipation(false)
    }
  }

  function onSave(e: FormEvent) {
    e.preventDefault()
    // changing which modes are AVAILABLE never touches stored participant modes,
    // but it changes what future registrants can pick — confirm deliberately
    if (participation !== initialParticipation) {
      setConfirmParticipation(true)
      return
    }
    void doSave()
  }

  async function upload(kind: 'logo_url' | 'banner_url' | 'currency_image_url', file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const url = await uploadEventMedia(event.id, file, kind.replace('_url', ''))
      await updateEvent(event.id, { [kind]: url })
      await refresh()
      toast('success', 'Image updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  // Removing branding clears the event's reference — the part the UI reads —
  // and deletes the stored file. Only the uploader may delete the object
  // (00001 storage policy), so when that is refused the reference is still
  // cleared and the toast says so rather than pretending the file is gone.
  async function removeImage(kind: 'logo_url' | 'banner_url') {
    if (removingImage) return
    const label = kind === 'logo_url' ? 'Logo' : 'Banner'
    const current = event[kind]
    setRemovingImage(true)
    setError(null)
    try {
      const fileDeleted = current ? await removeEventMedia(current) : true
      await updateEvent(event.id, { [kind]: null })
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
      <h2>Event settings</h2>
      <form onSubmit={onSave} className="stack">
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
              <option value="active">Active (registration &amp; participation open)</option>
              <option value="ended">Ended (frozen, results visible)</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            Theme color
            <input type="color" value={form.theme_color} onChange={(e) => set('theme_color', e.target.value)} />
          </label>
        </section>

        <section className="card stack">
          <h3>Participation</h3>
          <p className="muted">
            Which modes participants may choose when registering. Existing
            participants keep the mode they registered with.
          </p>
          <label>
            Available modes
            <select
              value={participation}
              onChange={(e) => setParticipation(e.target.value as Participation)}
            >
              <option value="solo">Solo only — individuals participate on their own</option>
              <option value="team">Teams only — participants join or create teams</option>
              <option value="both">Solo + Teams — participants choose how to take part</option>
            </select>
          </label>
          {participation !== 'solo' && (
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
          <h3>Capabilities</h3>
          <p className="muted">Enable only what this event needs.</p>
          <label className="check">
            <input type="checkbox" checked={capPoints} onChange={(e) => setCapPoints(e.target.checked)} />
            Points &amp; live leaderboard (scoring)
          </label>
          {capPoints && (
            <>
              <div className="row">
                <label>
                  Scoring unit (singular)
                  <input
                    value={form.currency_name} required placeholder="Point, Chip, Mark…"
                    onChange={(e) => set('currency_name', e.target.value)}
                  />
                </label>
                <label>
                  Scoring unit (plural)
                  <input
                    value={form.currency_name_plural} required placeholder="Points, Chips, Marks…"
                    onChange={(e) => set('currency_name_plural', e.target.value)}
                  />
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
                  Replace unit image
                  <input
                    type="file" accept="image/*" hidden
                    onChange={(e) => void upload('currency_image_url', e.target.files?.[0])}
                  />
                </label>
              </div>
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
          {capQr && (
            <label className="check cap-sub">
              <input
                type="checkbox" checked={capAttendance}
                onChange={(e) => setCapAttendance(e.target.checked)}
              />
              Attendance (staff-scanned check-in with timestamps)
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={capFeedback} onChange={(e) => setCapFeedback(e.target.checked)} />
            Feedback forms (event-native surveys, optional public QR)
          </label>
          <label className="check">
            <input type="checkbox" checked={capSubmissions} onChange={(e) => setCapSubmissions(e.target.checked)} />
            Submissions (participants/teams hand in their work/project)
          </label>
          {capSubmissions && (
            <label className="check cap-sub">
              <input type="checkbox" checked={capJudging} onChange={(e) => setCapJudging(e.target.checked)} />
              Judging (assigned judges score submissions against criteria)
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={capCertificates} onChange={(e) => setCapCertificates(e.target.checked)} />
            Certificates (issue verifiable participation/achievement certificates)
          </label>
        </section>

        {capPoints && (
          <section className="card stack">
            <h3>Leaderboard</h3>
            <label className="check">
              <input type="checkbox" checked={lbEnabled} onChange={(e) => setLbEnabled(e.target.checked)} />
              Show a live leaderboard for this event
            </label>
            {lbEnabled && (
              <>
                {participation === 'both' ? (
                  <label>
                    Who is ranked
                    <select
                      value={lbEntity === 'auto' ? 'combined' : lbEntity}
                      onChange={(e) => setLbEntity(e.target.value as LeaderboardEntity)}
                    >
                      <option value="individuals">Solo participants only</option>
                      <option value="teams">Teams only</option>
                      <option value="combined">Combined — solo participants and teams together</option>
                    </select>
                  </label>
                ) : (
                  <p className="muted">
                    {participation === 'team'
                      ? 'Teams are ranked — this event is teams-only.'
                      : 'Participants are ranked individually — this event is solo-only.'}
                  </p>
                )}
                {participation === 'both' && (lbEntity === 'combined' || lbEntity === 'auto') && (
                  <p className="muted">
                    Combined ranking compares team and individual scores on the same
                    scale, so teams (with more people earning) may naturally rank higher.
                  </p>
                )}
                <label>
                  Ranking metric
                  <select value={lbMetric} onChange={(e) => setLbMetric(e.target.value as LeaderboardMetric)}>
                    <option value="balance">{form.currency_name_plural || 'Points'} balance</option>
                    <option value="tasks">Tasks completed</option>
                  </select>
                </label>
                <label>
                  Visibility
                  <select value={lbVisibility} onChange={(e) => setLbVisibility(e.target.value as LeaderboardVisibility)}>
                    <option value="public">Public — anyone with the link, no sign-in needed</option>
                    <option value="participants">Participants — visible inside the event only</option>
                    <option value="hidden">Hidden — visible to event staff only</option>
                  </select>
                </label>
                {participation !== 'solo' && (
                  <label className="check">
                    <input type="checkbox" checked={lbMembers} onChange={(e) => setLbMembers(e.target.checked)} />
                    Show team member counts (never member names)
                  </label>
                )}
              </>
            )}
          </section>
        )}

        {capSubmissions && (
          <section className="card stack">
            <h3>Submissions</h3>
            <label>
              Deadline (optional)
              <input
                type="datetime-local" value={subDeadline}
                onChange={(e) => setSubDeadline(e.target.value)}
              />
            </label>
            <label>
              Instructions (shown above the submission form)
              <textarea
                rows={2} value={subInstructions} maxLength={2000}
                onChange={(e) => setSubInstructions(e.target.value)}
              />
            </label>
            {capJudging && (
              <label className="check">
                <input type="checkbox" checked={subAiAssist} onChange={(e) => setSubAiAssist(e.target.checked)} />
                AI-assisted judging — judges may request AI score suggestions per entry
              </label>
            )}
            {capJudging && subAiAssist && (
              <p className="muted">
                Suggestions are advisory: judges review and may change every score,
                and only finalized human evaluations count toward results. Requires
                the ai-service Edge Function to be deployed with a provider key.
              </p>
            )}
            {capJudging && (
              <label>
                Results visibility
                <select value={subResults} onChange={(e) => setSubResults(e.target.value as 'hidden' | 'participants')}>
                  <option value="hidden">Hidden — managers, judges and staff only</option>
                  <option value="participants">Participants — aggregate results, never judge notes</option>
                </select>
              </label>
            )}
            <h3>Submission fields</h3>
            <p className="muted">Extra structured fields entrants fill in (besides title and description).</p>
            {subFields.map((f, i) => (
              <div className="field-row" key={i}>
                <input
                  placeholder="Label" value={f.label}
                  onChange={(e) => setSubFields((fs) => fs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                />
                <select
                  value={f.type}
                  onChange={(e) => setSubFields((fs) => fs.map((x, j) => j === i ? { ...x, type: e.target.value as RegistrationField['type'] } : x))}
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="select">Choice</option>
                </select>
                {f.type === 'select' && (
                  <input
                    placeholder="Options, comma-separated"
                    value={(f.options ?? []).join(',')}
                    onChange={(e) => setSubFields((fs) => fs.map((x, j) => j === i ? { ...x, options: e.target.value.split(',') } : x))}
                  />
                )}
                <label className="check">
                  <input
                    type="checkbox" checked={f.required}
                    onChange={(e) => setSubFields((fs) => fs.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                  />
                  Required
                </label>
                <button
                  type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setSubFields((fs) => fs.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button" className="btn btn-ghost btn-sm"
              onClick={() => setSubFields((fs) => [...fs, { key: '', label: '', type: 'text', required: false }])}
            >
              + Add field
            </button>
          </section>
        )}

        <section className="card stack">
          <h3>Table allocation</h3>
          <p className="muted">
            Give each registration a table number in registration order: a solo
            participant gets the next table when they register; a team gets one
            when it is created, shared by all its members.
          </p>
          <label className="check">
            <input type="checkbox" checked={tblEnabled} onChange={(e) => setTblEnabled(e.target.checked)} />
            Allot tables automatically at registration
          </label>
          {tblEnabled && (
            <div className="row">
              <label>
                Label
                <input value={tblLabel} maxLength={24} onChange={(e) => setTblLabel(e.target.value)} placeholder="Table" />
              </label>
              <label>
                First number
                <input type="number" min={1} step={1} value={tblStart} onChange={(e) => setTblStart(Number(e.target.value))} />
              </label>
            </div>
          )}
          {tblEnabled && event.table_config.enabled && <TableAllocationPanel event={event} />}
          {tblEnabled && !event.table_config.enabled && (
            <p className="muted">Save to enable; you can then allot tables to participants who already registered.</p>
          )}
        </section>

        <section className="card stack">
          <h3>Branding</h3>
          <div className="media-row">
            {event.logo_url && <img src={event.logo_url} alt="" className="event-logo" />}
            <label className="btn btn-ghost btn-sm file-btn">
              {event.logo_url ? 'Replace logo' : 'Upload logo'}
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('logo_url', e.target.files?.[0])} />
            </label>
            {event.logo_url && (
              <button
                type="button" className="btn btn-ghost btn-sm" disabled={removingImage}
                onClick={() => setConfirmRemoveImage('logo_url')}
              >
                Remove logo
              </button>
            )}
            <label className="btn btn-ghost btn-sm file-btn">
              {event.banner_url ? 'Replace banner' : 'Upload banner'}
              <input type="file" accept="image/*" hidden onChange={(e) => void upload('banner_url', e.target.files?.[0])} />
            </label>
            {event.banner_url && (
              <button
                type="button" className="btn btn-ghost btn-sm" disabled={removingImage}
                onClick={() => setConfirmRemoveImage('banner_url')}
              >
                Remove banner
              </button>
            )}
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
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </form>

      <ConfirmDialog
        open={confirmRemoveImage !== null}
        title={`Remove ${confirmRemoveImage === 'logo_url' ? 'logo' : 'banner'}?`}
        confirmLabel="Remove"
        busy={removingImage}
        onConfirm={() => { if (confirmRemoveImage) void removeImage(confirmRemoveImage) }}
        onCancel={() => setConfirmRemoveImage(null)}
      >
        <p className="muted">
          The image is deleted from storage and this event stops using it. Every
          other event setting is untouched, and you can upload a new one at any time.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmParticipation}
        title="Change participation availability?"
        confirmLabel="Save changes"
        busy={busy}
        onConfirm={() => void doSave()}
        onCancel={() => setConfirmParticipation(false)}
      >
        <p className="muted">
          This changes which modes <strong>future</strong> registrants can choose.
          Participants who already registered keep the mode they chose — nobody is
          converted or removed, and no data is deleted.
        </p>
      </ConfirmDialog>

      {/* Outside the settings form: QR operations save independently per row,
          and nesting forms is invalid markup. */}
      {event.capabilities.qr && <QrConfigManager event={event} />}

      {/* Outside the settings form on purpose: nesting forms is invalid markup and
          would let a stray Enter key submit the wrong one. Deletion is club-management
          authority: platform admins, or club admins of this event's club — mirroring
          the events_delete RLS policy. Plain organizers configure but never delete. */}
      {isClubAdmin && <DangerZone event={event} />}
    </div>
  )
}

// manager view of the allocation list + backfill for units registered before
// the feature was switched on. All authorization is in the database.
function TableAllocationPanel({ event }: { event: EmpEvent }) {
  const toast = useToast()
  const [rows, setRows] = useState<EventTable[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  async function load() {
    try {
      const [tables, participants, teams] = await Promise.all([
        listEventTables(event.id),
        listParticipants(event.id),
        listTeams(event.id),
      ])
      const map: Record<string, string> = {}
      for (const p of participants) map[`p:${p.id}`] = p.display_name
      for (const t of teams) map[`t:${t.id}`] = t.name
      setNames(map)
      setRows(tables)
    } catch {
      setRows([])
    }
  }
  useEffect(() => { void load() }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function assign() {
    setBusy(true)
    try {
      const n = await assignEventTables(event.id)
      toast('success', n === 0 ? 'Everyone already has a table' : `${n} table${n === 1 ? '' : 's'} allotted`)
      await load()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not allot tables')
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    setBusy(true)
    try {
      await clearEventTables(event.id)
      toast('success', 'Table allocations cleared')
      setConfirmClear(false)
      await load()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not clear tables')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void assign()}>
          Allot tables to unassigned registrations
        </button>
        {rows && rows.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmClear(true)}>
            Clear all
          </button>
        )}
      </div>
      {rows === null && <p className="muted">Loading…</p>}
      {rows !== null && rows.length === 0 && <p className="muted">No tables allotted yet.</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="table-list">
          {rows.map((r) => (
            <li key={r.id}>
              <strong>{formatTable(event.table_config, r.table_number)}</strong>
              <span>
                {r.team_id ? (names[`t:${r.team_id}`] ?? 'Team') : (names[`p:${r.participant_id}`] ?? 'Participant')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmClear}
        title="Clear all table allocations?"
        confirmLabel="Clear tables"
        busy={busy}
        onConfirm={() => void clearAll()}
        onCancel={() => setConfirmClear(false)}
      >
        <p className="muted">
          Every participant and team loses their table number. Re-allotting
          afterwards numbers everyone again in registration order.
        </p>
      </ConfirmDialog>
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
        Its participants, teams, tasks, announcements and the entire scoring
        ledger — every balance and transaction — are deleted with it.
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
