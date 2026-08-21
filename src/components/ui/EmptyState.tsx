import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// An empty screen is an invitation to act: icon, message, optional guidance
// and an optional action for those who can do something about it.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={40} strokeWidth={1.5} className="empty-state-icon" aria-hidden />}
      <p className="empty-state-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
