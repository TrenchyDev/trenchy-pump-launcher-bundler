import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Launch from './pages/Launch'
import Wallets from './pages/Wallets'
import Trading from './pages/Trading'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/launch" replace />} />
        <Route path="/launch" element={<Launch />} />
        <Route path="/wallets" element={<Wallets />} />
        <Route path="/trading" element={<Trading />} />
      </Route>
    </Routes>
  )
}
