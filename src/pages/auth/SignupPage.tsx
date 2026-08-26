import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { GoogleSignInButton } from '../../components/GoogleSignInButton'

export function SignupPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    if (data.session) {
      navigate('/', { replace: true })
    } else {
      // TEMP (email confirmation disabled for the event): no "check your
      // email" prompt. To revert when confirmation is re-enabled, restore:
      //   setNotice('Check your email to confirm your account, then log in.')
      setNotice('Account created successfully. You can now log in.')
    }
  }

  return (
    <div className="auth-card">
      <h1>Create account</h1>
      <GoogleSignInButton onError={setError} />
      <p className="or-divider" aria-hidden>or</p>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          Email
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required autoComplete="email" placeholder="Enter Your College Mail ID"
          />
        </label>
        <label>
          Password
          <PasswordInput
            value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={8} autoComplete="new-password" placeholder="Minimum 8 characters"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-notice">{notice}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
      <p className="auth-alt">Already have an account? <Link to="/login">Log in</Link></p>
    </div>
  )
}
