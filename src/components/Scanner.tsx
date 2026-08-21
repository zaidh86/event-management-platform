import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw } from 'lucide-react'
import { Html5Qrcode } from 'html5-qrcode'

// Camera QR scanner with an explicit lifecycle: the camera never starts on its
// own — staff/judges press "Start camera", and every state (ready, requesting
// access, live preview, permission denied, no usable camera) is visible and
// recoverable. Calls onScan once per distinct token until reset.
//
// The scanner SHELL is one persistent, properly-sized box: html5-qrcode
// measures its container when start() is called, so the container must be
// visible with real dimensions at that moment (a previous `:empty {
// display:none }` rule made it 0-width — the camera ran with an invisible
// preview). The injected <video> fills the shell via object-fit: cover, and
// the scanning guide frame is our own overlay (no html5-qrcode qrbox, whose
// internal shading would misalign with the cover-fit video; decoding still
// covers the full frame).

type ScannerState = 'idle' | 'starting' | 'scanning' | 'error'
type ErrorKind = 'permission' | 'unavailable' | 'other'

function classifyError(err: unknown): ErrorKind {
  const name = err instanceof Error || err instanceof DOMException ? err.name : ''
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError'
    || msg.includes('permission') || msg.includes('denied')) return 'permission'
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError'
    || msg.includes('not found') || msg.includes('no camera') || msg.includes('notreadable')
    || msg.includes('in use') || msg.includes('unable to')) return 'unavailable'
  return 'other'
}

const ERROR_TEXT: Record<ErrorKind, string> = {
  permission:
    'Camera permission denied. Allow camera access for this site in your browser settings, then try again — or enter codes manually below.',
  unavailable:
    'Camera unavailable — the device may not have one, or another app is using it. Manual code entry still works below.',
  other: 'The camera could not be started. Manual code entry still works below.',
}

export function Scanner({ onScan }: { onScan: (token: string) => void }) {
  const lastToken = useRef<string | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [state, setState] = useState<ScannerState>('idle')
  const [errorKind, setErrorKind] = useState<ErrorKind>('other')

  async function start() {
    if (state === 'starting' || state === 'scanning') return
    setState('starting')
    try {
      // the shell div is always mounted AND visible with real dimensions,
      // so html5-qrcode sizes the injected video correctly
      const scanner = scannerRef.current ?? new Html5Qrcode('emp-scanner')
      scannerRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10 }, // full-frame decoding; the guide frame is our overlay
        (text) => {
          if (text && text !== lastToken.current) {
            lastToken.current = text
            onScanRef.current(text)
          }
        },
        () => {}, // per-frame decode misses are expected noise
      )
      setState('scanning')
    } catch (err) {
      setErrorKind(classifyError(err))
      setState('error')
    }
  }

  async function stop() {
    const scanner = scannerRef.current
    if (!scanner) return
    try {
      // stop() ends every MediaStream track (camera indicator turns off);
      // clear() removes the injected video so the shell returns to idle
      if (scanner.isScanning) await scanner.stop()
      scanner.clear()
    } catch {
      // stopping a camera that already died is fine
    }
    setState('idle')
  }

  // release the camera when leaving the page
  useEffect(() => {
    return () => {
      const scanner = scannerRef.current
      if (scanner?.isScanning) {
        void scanner.stop().then(() => scanner.clear()).catch(() => {})
      }
    }
  }, [])

  return (
    <div className="scanner-wrap">
      <div className={`scanner-shell ${state === 'scanning' ? 'scanner-shell-live' : ''}`}>
        {/* html5-qrcode injects its <video> here; CSS makes it fill the shell */}
        <div id="emp-scanner" className="scanner-feed" />

        {state === 'scanning' && <div className="scan-frame" aria-hidden />}

        {state !== 'scanning' && (
          <div className="scanner-overlay">
            {state === 'idle' && (
              <>
                <Camera size={28} aria-hidden className="scanner-overlay-icon" />
                <p role="status">Camera ready to scan</p>
                <p className="muted">The camera starts only when you tap the button.</p>
                <button type="button" className="btn btn-primary" onClick={() => void start()}>
                  Start camera
                </button>
              </>
            )}
            {state === 'starting' && (
              <p role="status" className="muted">
                Requesting camera access… your browser may ask for permission.
              </p>
            )}
            {state === 'error' && (
              <>
                <p role="alert" className="form-error">{ERROR_TEXT[errorKind]}</p>
                <button type="button" className="btn btn-ghost" onClick={() => void start()}>
                  <RefreshCw size={16} aria-hidden /> Try again
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {state === 'scanning' && (
        <div className="scanner-status">
          <p role="status" className="muted">Live — point the camera at a QR code.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void stop()}>
            Stop camera
          </button>
        </div>
      )}
    </div>
  )
}
