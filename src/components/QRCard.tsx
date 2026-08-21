import { QRCodeSVG } from 'qrcode.react'

// Renders an entity's QR for scanning at event stations. The payload is an
// opaque backend token — it carries no personal information. The purpose is
// communicated by the label/description; the token itself is echoed in muted
// text under the image so it can be copied for manual entry at a station.
export function QRCard({
  token,
  label,
  description,
}: {
  token: string
  label: string
  description?: string
}) {
  return (
    <div className="qr-card">
      <div className="qr-label">{label}</div>
      {description && <p className="qr-desc muted">{description}</p>}
      <div className="qr-box">
        <QRCodeSVG value={token} size={180} marginSize={2} />
      </div>
      <code className="qr-token">{token}</code>
    </div>
  )
}
