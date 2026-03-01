import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function Layout() {
  return (
    <div className="layout-root">
      <div className="noise-bg" />
      <div className="ambient-glow" />
      <Sidebar />
      <div className="main-area">
        <Header />
        <main style={{ padding: 24 }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
