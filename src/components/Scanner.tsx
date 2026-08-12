import { useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

// Camera QR scanner. Calls onScan once per distinct token until reset.
export function Scanner({ onScan }: { onScan: (token: string) => void }) {
  const lastToken = useRef<string | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    const scanner = new Html5Qrcode('emp-scanner')
    let stopped = false

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => {
          if (text && text !== lastToken.current) {
            lastToken.current = text
            onScanRef.current(text)
          }
        },
        () => {}, // per-frame decode misses are expected noise
      )
      .catch((err: unknown) => {
        const el = document.getElementById('emp-scanner')
        if (el) {
          el.textContent =
            'Camera unavailable: ' + (err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      stopped = true
      void scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {
          if (!stopped) scanner.clear()
        })
    }
  }, [])

  return <div id="emp-scanner" className="scanner-box" />
}
