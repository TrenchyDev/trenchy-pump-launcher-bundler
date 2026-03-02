import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import axios from 'axios'
import Sidebar from './Sidebar'
import Header from './Header'

interface LayoutProps {
  onClearSession?: () => void
}

export default function Layout({ onClearSession }: LayoutProps) {
  const [missingKeys, setMissingKeys] = useState<string[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    axios.get('/api/env').then(r => setMissingKeys(r.data.missingRequired ?? [])).catch(() => {})
  }, [])

  return (
    <div className="layout-root">
      <div className="noise-bg" />
      <div className="ambient-glow" />
      <Sidebar envWarning={missingKeys.length > 0} onClearSession={onClearSession} />
      <div className="main-area">
        <Header />
        {missingKeys.length > 0 && (
          <div
            onClick={() => navigate('/settings')}
            style={{
              margin: '16px 24px 0',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 10,
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)')}
          >
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: '#f87171', fontSize: 16, fontWeight: 800 }}>!</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f87171', fontWeight: 600, fontSize: 13 }}>
                Environment not configured
              </div>
              <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 2 }}>
                Go to Settings to set up your RPC endpoint, funding key, and other required values.
              </div>
            </div>
            <span style={{ color: '#f87171', fontSize: 18 }}>&rarr;</span>
          </div>
        )}
        <main style={{ padding: 24 }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
