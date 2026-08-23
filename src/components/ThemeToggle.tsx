import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePref } from '../contexts/ThemeContext'

// The single compact appearance control, backed by the one ThemeContext
// (same state, same localStorage persistence, same pre-paint handling as
// Settings → Appearance). Cycles Light → Dark → System. Used by the public
// topbar (signed-out visitors) and by standalone public pages such as the
// QR-opened feedback form, which render outside the app shell.
const NEXT_PREF: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' }
const PREF_LABEL: Record<ThemePref, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { pref, setPref } = useTheme()
  const Icon = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor
  const label = `Appearance: ${PREF_LABEL[pref]}. Switch to ${PREF_LABEL[NEXT_PREF[pref]]}.`
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon ${className}`.trim()}
      onClick={() => setPref(NEXT_PREF[pref])}
      title={label}
      aria-label={label}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}
