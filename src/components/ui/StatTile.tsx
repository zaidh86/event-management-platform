import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// Compact metric tile: uppercase label, big tabular value. `children` replaces
// the plain value when the metric needs custom content (e.g. an image + amount).
export function StatTile({
  label,
  value,
  icon: Icon,
  children,
}: {
  label: string
  value?: string | number
  icon?: LucideIcon
  children?: ReactNode
}) {
  return (
    <div className="stat-tile">
      <div className="stat-kicker">
        {Icon && <Icon size={13} aria-hidden />}
        {label}
      </div>
      <div className="stat-value">{children ?? value}</div>
    </div>
  )
}
