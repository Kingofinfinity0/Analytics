import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from './supabase'

export default function Auth() {
  const isSignUp = useLocation().pathname === '/signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setMessage('')
    const result = isSignUp
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    if (isSignUp && !result.data.session) setMessage('Check your email to confirm your account, then return here to log in.')
  }

  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Analytics</p><h1>{isSignUp ? 'Create your account' : 'Welcome back'}</h1><p className="auth-copy">{isSignUp ? 'Use one account to access your private analytics workspace.' : 'Log in to view your analytics workspace.'}</p><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength="6" autoComplete={isSignUp ? 'new-password' : 'current-password'} /></label>{error && <p className="auth-error">{error}</p>}{message && <p className="auth-message">{message}</p>}<button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Log in'}</button></form><p className="auth-switch">{isSignUp ? 'Already have an account?' : 'New here?'} <Link to={isSignUp ? '/login' : '/signup'}>{isSignUp ? 'Log in' : 'Create one'}</Link></p></section></main>
}
