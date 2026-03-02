import { useState } from 'react'
import axios from 'axios'

export default function Login({ onAuth }: { onAuth: (token: string, user: { id: number; username: string }) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await axios.post(endpoint, { username: username.trim(), password })
      onAuth(res.data.token, res.data.user)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0b1118',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        padding: '0 20px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/image/trencherlogo.png"
            alt="Trencher"
            style={{ height: 48, marginBottom: 16 }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            {mode === 'login' ? 'Sign in to your account' : 'Register a new account to get started'}
          </p>
        </div>

        <div style={{
          background: 'rgba(17, 25, 33, 0.95)',
          border: '1px solid rgba(37, 51, 70, 0.5)',
          borderRadius: 12,
          padding: 28,
          backdropFilter: 'blur(12px)',
        }}>
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 20,
              fontSize: 12,
              color: '#f87171',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Username
              </label>
              <input
                className="input"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoFocus
                style={{ width: '100%', fontSize: 13, fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Password
              </label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                style={{ width: '100%', fontSize: 13, fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <button
              className="btn-primary"
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              style={{
                width: '100%',
                padding: '10px 0',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div style={{
            marginTop: 20,
            textAlign: 'center',
            fontSize: 12,
            color: '#64748b',
          }}>
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <span
                  onClick={() => { setMode('register'); setError(null) }}
                  style={{ color: '#14b8a6', cursor: 'pointer', fontWeight: 600 }}
                >
                  Register
                </span>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <span
                  onClick={() => { setMode('login'); setError(null) }}
                  style={{ color: '#14b8a6', cursor: 'pointer', fontWeight: 600 }}
                >
                  Sign in
                </span>
              </>
            )}
          </div>
        </div>

        <p style={{
          textAlign: 'center',
          marginTop: 24,
          fontSize: 10,
          color: '#334155',
        }}>
          Your keys are stored server-side. Encryption coming soon.
        </p>
      </div>
    </div>
  )
}
