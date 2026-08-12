import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

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
      // email confirmation enabled on the Supabase project
      setNotice('Check your email to confirm your account, then sign in.')
    }
  }

  return (
    <div className="auth-card">
      <h1>Create account</h1>
      <form onSubmit={(e) => void onSubmit(e)} className="stack">
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={8} autoComplete="new-password"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {notice && <p className="form-notice">{notice}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
      <p className="auth-alt">Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  )
}
