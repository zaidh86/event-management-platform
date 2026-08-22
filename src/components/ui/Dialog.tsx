import { useEffect, useRef, type ReactNode } from 'react'

// Confirmation dialog replacing native confirm(). Controlled: render with
// open, and handle onConfirm/onCancel. Escape and backdrop-click cancel.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  // blocks confirming without claiming work is in progress — busy owns the
  // "Working…" label, this only greys the button while input is incomplete
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Callers pass inline arrows and locally-declared functions, so onCancel and
  // busy get a fresh identity on every parent render. Reading them through refs
  // keeps the effects below keyed on `open` alone — otherwise each keystroke
  // typed into a field inside the dialog would re-run them and yank focus back
  // to the confirm button.
  const cancelRef = useRef(onCancel)
  const busyRef = useRef(busy)
  useEffect(() => {
    cancelRef.current = onCancel
    busyRef.current = busy
  })

  // focus the confirm button on the OPEN transition only
  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  // Escape cancels — but never mid-request, matching the backdrop and buttons,
  // so a dialog cannot be dismissed out from under an in-flight write
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) cancelRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onCancel()}>
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
