import { NavLink } from 'react-router-dom'
import { RocketLaunchIcon, ChartBarIcon, WalletIcon, SignalIcon } from '@heroicons/react/24/outline'

const links = [
  { to: '/launch', label: 'Launch', Icon: RocketLaunchIcon },
  { to: '/trading', label: 'Trading', Icon: ChartBarIcon },
  { to: '/wallets', label: 'Wallets', Icon: WalletIcon },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">P</div>
        <div>
          <div className="sidebar-logo-text">Pump Launcher</div>
          <div className="sidebar-logo-sub">Token Deployer</div>
        </div>
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
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '16px 18px', borderTop: '1px solid rgba(37,51,70,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b' }}>
          <SignalIcon style={{ width: 14, height: 14, color: '#14b8a6' }} />
          <span>Mainnet</span>
        </div>
      </div>
    </aside>
  )
}
