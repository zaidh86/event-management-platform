import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, QrCode, Trash2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  createQrConfig, deleteQrConfig, listFeedbackForms, listQrConfigs, updateQrConfig,
} from '../lib/api'
import {
  ACCESS_LABELS, ACTION_LABELS, TARGET_ACTIONS, TARGET_LABELS,
  accessOptionsFor, publicQrUrl, summarizeAccess, summarizeActions,
} from '../lib/qr'
import { ConfirmDialog } from './ui/Dialog'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'
import { useToast } from './ui/Toast'
import type {
  EmpEvent, FeedbackForm, QrAction, QrConfig, QrTarget, ScannerAccess,
} from '../lib/types'

// Event Manager surface for universal QR operations (ADR-0009). Each
// configuration = label + purpose + target + allowed actions + scanner access.
// The database constraints and perform_scan are the enforcement layer — this
// component only offers valid combinations.

interface Draft {
  id: string | null
  label: string
  description: string
  target: QrTarget
  actions: QrAction[]
  scanner_access: ScannerAccess[]
  feedback_form_id: string
}

const EMPTY_DRAFT: Draft = {
  id: null,
  label: '',
  description: '',
  target: 'participant',
  actions: ['attendance'],
  scanner_access: ['organizer', 'activity_admin', 'volunteer'],
  feedback_form_id: '',
}

export function QrConfigManager({ event }: { event: EmpEvent }) {
  const toast = useToast()
  const [configs, setConfigs] = useState<QrConfig[] | null>(null)
  const [forms, setForms] = useState<FeedbackForm[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<QrConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    listQrConfigs(event.id).then(setConfigs).catch(() => setConfigs([]))
  }, [event.id])

  useEffect(() => {
    reload()
    if (event.capabilities.feedback) {
      listFeedbackForms(event.id).then(setForms).catch(() => {})
    }
  }, [reload, event.id, event.capabilities.feedback])

  // targets and actions offered follow the event's capabilities
  const targets: QrTarget[] = (['participant', 'team', 'event', 'feedback'] as QrTarget[]).filter(
    (t) =>
      (t !== 'team' || event.capabilities.teams)
      && (t !== 'feedback' || event.capabilities.feedback),
  )

  function actionsFor(target: QrTarget): QrAction[] {
    // 'scoring' serves BOTH scoring paths: the points ledger (points
    // capability, staff award panel) and judge evaluations (judging
    // capability, existing judging interface) — offering it when either is on.
    // Hiding it behind points alone wrongly removed Scoring from judged
    // events (Informatique Exhib fix).
    return TARGET_ACTIONS[target].filter(
      (a) =>
        (a !== 'attendance' || event.capabilities.attendance)
        && (a !== 'scoring' || event.capabilities.points || event.capabilities.judging)
        && (a !== 'feedback' || event.capabilities.feedback),
    )
  }

  function startEdit(cfg: QrConfig) {
    setError(null)
    setDraft({
      id: cfg.id,
      label: cfg.label,
      description: cfg.description,
      target: cfg.target,
      actions: cfg.actions,
      scanner_access: cfg.scanner_access,
      feedback_form_id: cfg.config.feedback_form_id ?? '',
    })
  }

  function setTarget(target: QrTarget) {
    // switching targets resets actions/access to sensible valid defaults
    const acts = actionsFor(target)
    setDraft((d) => d && {
      ...d,
      target,
      actions: acts.length > 0 ? [acts[0]] : [],
      scanner_access:
        target === 'event' || target === 'feedback'
          ? ['public']
          : ['organizer', 'activity_admin', 'volunteer'],
    })
  }

  async function save() {
    if (!draft || busy) return
    if (draft.label.trim() === '') {
      setError('Give this QR operation a name')
      return
    }
    if (draft.actions.length === 0) {
      setError('Select at least one action')
      return
    }
    if (draft.scanner_access.length === 0) {
      setError('Select who can use this QR operation')
      return
    }
    if (draft.target === 'feedback' && !draft.feedback_form_id) {
      setError('Choose the feedback form the feedback action opens')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fields = {
        label: draft.label.trim(),
        description: draft.description.trim(),
        target: draft.target,
        actions: draft.actions,
        scanner_access: draft.scanner_access,
        config: draft.target === 'feedback'
          ? { feedback_form_id: draft.feedback_form_id }
          : {},
      }
      if (draft.id) {
        await updateQrConfig(draft.id, fields)
        toast('success', 'QR operation updated')
      } else {
        await createQrConfig({ event_id: event.id, ...fields })
        toast('success', 'QR operation created')
      }
      setDraft(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function toggleEnabled(cfg: QrConfig) {
    try {
      await updateQrConfig(cfg.id, { is_enabled: !cfg.is_enabled })
      toast('success', cfg.is_enabled ? `${cfg.label} disabled` : `${cfg.label} enabled`)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await deleteQrConfig(confirmDelete.id)
      toast('success', `${confirmDelete.label} removed`)
      setConfirmDelete(null)
      reload()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Delete failed')
      setConfirmDelete(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <h3>QR operations</h3>
      <p className="muted">
        Configure the QR codes this event actually needs — attendance,
        verification, scoring, promotion, feedback. Participants see the
        operations that apply to them under "My QR codes"; staff run them from
        the scan station.
      </p>

      {configs === null && <Skeleton lines={2} height="2.4rem" />}
      {configs !== null && configs.length === 0 && !draft && (
        <EmptyState
          icon={QrCode}
          title="No QR operations configured"
          hint="Without configuration, the event uses the default participant/team QR with the general scoring station."
        />
      )}

      {configs?.map((cfg) => (
        <div key={cfg.id} className={`qr-config-row ${cfg.is_enabled ? '' : 'qr-config-disabled'}`}>
          <div className="qr-config-main">
            <div className="qr-config-title">
              <strong>{cfg.label}</strong>
              {!cfg.is_enabled && <span className="badge">disabled</span>}
            </div>
            {cfg.description && <p className="muted">{cfg.description}</p>}
            <p className="muted qr-config-meta">
              {TARGET_LABELS[cfg.target]} · {summarizeActions(cfg.actions)} · {summarizeAccess(cfg.scanner_access)}
            </p>
            {(cfg.target === 'event' || cfg.target === 'feedback') && (
              <PublicQrPreview token={cfg.qr_token} />
            )}
          </div>
          <div className="qr-config-actions">
            <label className="check">
              <input type="checkbox" checked={cfg.is_enabled} onChange={() => void toggleEnabled(cfg)} />
              Enabled
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(cfg)}>
              <Pencil size={14} aria-hidden /> Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(cfg)}>
              <Trash2 size={14} aria-hidden /> Remove
            </button>
          </div>
        </div>
      ))}

      {draft ? (
        <div className="card stack qr-config-editor">
          <h3>{draft.id ? 'Edit QR operation' : 'New QR operation'}</h3>
          <label>
            Name
            <input
              value={draft.label} maxLength={60}
              placeholder="Attendance QR, Team Verification QR, Event Registration…"
              onChange={(e) => setDraft((d) => d && { ...d, label: e.target.value })}
            />
          </label>
          <label>
            Purpose (shown to participants)
            <input
              value={draft.description} maxLength={200}
              placeholder="Used by event staff to record participant attendance."
              onChange={(e) => setDraft((d) => d && { ...d, description: e.target.value })}
            />
          </label>
          <label>
            What does this QR identify?
            <select value={draft.target} onChange={(e) => setTarget(e.target.value as QrTarget)}>
              {targets.map((t) => <option key={t} value={t}>{TARGET_LABELS[t]}</option>)}
            </select>
          </label>

          {draft.target === 'feedback' ? (
            <label>
              Feedback form
              <select
                value={draft.feedback_form_id}
                onChange={(e) => setDraft((d) => d && { ...d, feedback_form_id: e.target.value })}
              >
                <option value="">Select a form…</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}{f.status !== 'published' ? ` (${f.status})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <fieldset className="qr-fieldset">
              <legend>Allowed actions</legend>
              {actionsFor(draft.target).map((a) => (
                <label className="check" key={a}>
                  <input
                    type="checkbox"
                    checked={draft.actions.includes(a)}
                    onChange={(e) =>
                      setDraft((d) => d && {
                        ...d,
                        actions: e.target.checked
                          ? [...d.actions, a]
                          : d.actions.filter((x) => x !== a),
                      })}
                  />
                  {ACTION_LABELS[a]}
                </label>
              ))}
              {actionsFor(draft.target).length === 0 && (
                <p className="muted">
                  Enable the matching capabilities (attendance, scoring) to offer
                  actions for this target.
                </p>
              )}
              {/* scoring hidden for this target: say WHY instead of vanishing
                  silently (Informatique Exhib fix) */}
              {(draft.target === 'participant' || draft.target === 'team')
                && !actionsFor(draft.target).includes('scoring') && (
                <p className="muted">
                  Scoring is hidden because this event has neither Points nor
                  Judging enabled. Turn on <strong>Points</strong>, or{' '}
                  <strong>Submissions + Judging</strong>, in Event settings →
                  Capabilities.
                </p>
              )}
            </fieldset>
          )}

          <fieldset className="qr-fieldset">
            <legend>{draft.target === 'event' || draft.target === 'feedback' ? 'Who can use it' : 'Who can scan it'}</legend>
            {accessOptionsFor(draft.target).map((r) => (
              <label className="check" key={r}>
                <input
                  type="checkbox"
                  checked={draft.scanner_access.includes(r)}
                  onChange={(e) =>
                    setDraft((d) => d && {
                      ...d,
                      scanner_access: e.target.checked
                        ? [...d.scanner_access, r]
                        : d.scanner_access.filter((x) => x !== r),
                    })}
                />
                {ACCESS_LABELS[r]}
              </label>
            ))}
          </fieldset>

          {error && <p className="form-error">{error}</p>}
          <div className="row">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create QR operation'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button" className="btn btn-ghost"
          onClick={() => {
            setError(null)
            setDraft({ ...EMPTY_DRAFT, actions: actionsFor('participant').slice(0, 1) })
          }}
        >
          <Plus size={16} aria-hidden /> Add QR operation
        </button>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Remove "${confirmDelete?.label ?? ''}"?`}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDelete(null)}
      >
        <p className="muted">
          Participants and staff will no longer see or use this QR operation.
          Its past scan history is kept. If you may need it again, disable it
          instead of removing it.
        </p>
      </ConfirmDialog>
    </section>
  )
}

// poster/venue QR for event & feedback targets: the image encodes a public URL
// so any phone camera opens it — no EMP scanner needed
function PublicQrPreview({ token }: { token: string }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const url = publicQrUrl(token)
  return (
    <div className="qr-public-preview">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
        <QrCode size={14} aria-hidden /> {open ? 'Hide QR' : 'Show QR'}
      </button>
      <button
        type="button" className="btn btn-ghost btn-sm"
        onClick={() => {
          void navigator.clipboard?.writeText(url)
            .then(() => toast('success', 'Link copied'))
            .catch(() => toast('error', 'Could not copy — the link is shown below'))
          setOpen(true)
        }}
      >
        Copy link
      </button>
      {open && (
        <div className="qr-public-box">
          <QRCodeSVG value={url} size={180} marginSize={2} />
          <code className="qr-token">{url}</code>
        </div>
      )}
    </div>
  )
}
