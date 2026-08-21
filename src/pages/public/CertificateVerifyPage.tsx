import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BadgeCheck, Printer, ShieldX } from 'lucide-react'
import { verifyCertificate } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import type { VerifiedCertificate } from '../../lib/types'

const KIND_LABEL: Record<string, string> = {
  participation: 'Certificate of Participation',
  completion: 'Certificate of Completion',
  achievement: 'Certificate of Achievement',
}

// Public certificate verification + printable certificate (/cert/:code).
// verify_certificate (00017) exposes only: event name/branding, holder display
// name, kind/title/detail, issue date — nothing else, valid or not.
export function CertificateVerifyPage() {
  const { code } = useParams<{ code: string }>()
  const [cert, setCert] = useState<VerifiedCertificate | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!code) return
    verifyCertificate(code).then(setCert).catch(() => setError(true))
  }, [code])

  if (error || (cert && !cert.valid)) {
    return (
      <div className="public-landing">
        <p className="cert-invalid"><ShieldX size={28} aria-hidden /></p>
        <h1>Certificate not found</h1>
        <p className="muted">
          This verification code is not valid — the certificate may have been
          revoked or the link mistyped.
        </p>
      </div>
    )
  }
  if (!cert) return <div className="public-landing"><p className="muted">Verifying…</p></div>

  return (
    <div className="public-landing">
      <div
        className="certificate"
        style={cert.theme_color ? { ['--theme' as string]: cert.theme_color } : undefined}
      >
        {cert.event_logo_url && <img src={cert.event_logo_url} alt="" className="event-logo" />}
        <p className="certificate-kicker">{cert.event_name}</p>
        <h1>{cert.title || KIND_LABEL[cert.kind ?? 'participation']}</h1>
        <p className="certificate-holder">
          {cert.holder_type === 'team' ? 'Awarded to team' : 'Awarded to'}
        </p>
        <p className="certificate-name">{cert.holder_name}</p>
        {cert.detail && <p className="certificate-detail">{cert.detail}</p>}
        <p className="muted certificate-meta">
          Issued {cert.issued_at ? fmtDateTime(cert.issued_at) : ''}
        </p>
        <p className="certificate-verify">
          <BadgeCheck size={16} aria-hidden /> Verified · {cert.verify_code}
        </p>
      </div>
      <div className="row public-landing-actions print-hide">
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden /> Print / save as PDF
        </button>
      </div>
      <p className="muted print-hide">
        Anyone with this link can confirm the certificate is genuine.
      </p>
    </div>
  )
}
