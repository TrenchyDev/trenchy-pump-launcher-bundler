import { NavLink } from 'react-router-dom'
import { RocketLaunchIcon, ChartBarIcon, WalletIcon, Cog6ToothIcon, SignalIcon, ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline'

const links = [
  { to: '/launch', label: 'Launch', Icon: RocketLaunchIcon },
  { to: '/trading', label: 'Trading', Icon: ChartBarIcon },
  { to: '/wallets', label: 'Wallets', Icon: WalletIcon },
  { to: '/settings', label: 'Settings', Icon: Cog6ToothIcon },
]

interface SidebarProps {
  envWarning?: boolean
  onClearSession?: () => void
}

export default function Sidebar({ envWarning = false, onClearSession }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/image/trencherlogo.png" alt="Trencher" style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
      </div>

      <nav style={{ flex: 1, padding: '12px 0' }}>
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <link.Icon style={{ width: 18, height: 18 }} />
            {link.label}
            {link.to === '/settings' && envWarning && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#ef4444', marginLeft: 'auto', flexShrink: 0,
                boxShadow: '0 0 8px rgba(239,68,68,0.5)',
              }} />
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(37,51,70,0.5)' }}>
        {onClearSession && (
          <button
            onClick={onClearSession}
            title="Clear session"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 0', width: '100%',
              fontSize: 12, color: '#64748b', transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          >
            <ArrowRightStartOnRectangleIcon style={{ width: 16, height: 16 }} />
            Clear session
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b' }}>
          <SignalIcon style={{ width: 14, height: 14, color: '#14b8a6' }} />
          <span>Mainnet</span>
        </div>
      </div>
    </aside>
  )
}
