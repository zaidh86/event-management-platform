import { QRCodeSVG } from 'qrcode.react'

// Renders an entity's QR token for scanning at activity stations.
export function QRCard({ token, label }: { token: string; label: string }) {
  return (
    <div className="qr-card">
      <div className="qr-box">
        <QRCodeSVG value={token} size={180} marginSize={2} />
      </div>
      <div className="qr-label">{label}</div>
      <code className="qr-token">{token}</code>
    </div>
  )
}
