import { useId, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Password field with a show/hide toggle. The toggle is a real button
// (type="button", so it never submits the form), keyboard reachable, and
// labelled for assistive tech. The value is never logged or stored here —
// it flows straight to the caller's state and on to Supabase Auth.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function PasswordInput({ value, onChange, className, ...rest }: Props) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  return (
    <span className="password-field">
      <input
        {...rest}
        id={rest.id ?? id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={className}
        spellCheck={false}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </span>
  )
}
