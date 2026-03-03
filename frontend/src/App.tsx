import { Routes, Route, Navigate } from 'react-router-dom'
import axios from 'axios'
import Layout from './components/layout/Layout'
import Launch from './pages/Launch'
import Wallets from './pages/Wallets'
import Trading from './pages/Trading'
import Settings from './pages/Settings'
import { SESSION_KEY, FUNDING_KEY, getOrCreateSessionId } from './pages/Setup'

axios.interceptors.request.use(config => {
  const sessionId = localStorage.getItem(SESSION_KEY) || getOrCreateSessionId()
  config.headers['X-Session-Id'] = sessionId
  return config
})

axios.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && err.config?.url?.includes('/api/')) {
      const msg = err.response?.data?.error || ''
      if (msg.includes('Funding wallet not configured')) {
        localStorage.removeItem(FUNDING_KEY)
        // Don't redirect - let user go to Settings to add wallet
        if (!window.location.pathname.startsWith('/settings')) {
          window.location.href = '/settings'
        }
      }
    }
    return Promise.reject(err)
  },
)

export default function App() {
  function handleClearSession() {
    localStorage.removeItem(FUNDING_KEY)
    window.location.href = '/settings'
  }

  return (
    <Routes>
      <Route element={<Layout onClearSession={handleClearSession} />}>
        <Route path="/" element={<Navigate to="/launch" replace />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/wallets" element={<Wallets />} />
        <Route path="/trading" element={<Trading />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
