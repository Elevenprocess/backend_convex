import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon, type IconName } from '../Icon'
import { useRole, type Role } from '../../lib/role'

type Item = { to: string; icon: IconName; label: string; roles?: Role[] }

const ITEMS: Item[] = [
  { to: '/overview', icon: 'home', label: 'Overview' },
  { to: '/leads', icon: 'users', label: 'Leads' },
  { to: '/rdv', icon: 'calendar', label: 'RDV' },
  { to: '/notifications', icon: 'bell', label: 'Rappels' },
  { to: '/analytics', icon: 'chart', label: 'Analytics' },
  { to: '/settings', icon: 'settings', label: 'Settings', roles: ['admin'] },
]

const SIDEBAR_STORAGE_KEY = 'ecoi.sidebar.expanded'

export function Sidebar() {
  const role = useRole((s) => s.role)
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  })
  const visible = ITEMS.filter((it) => !it.roles || it.roles.includes(role))

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded))
  }, [expanded])

  return (
    <aside className={`app-sidebar ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-brand" title="Electro Concept OI">
        <div className="sidebar-logo">E</div>
        <span className="sidebar-brand-text">ECOI</span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="sidebar-toggle"
        title={expanded ? 'Réduire le menu' : 'Agrandir le menu'}
        aria-label={expanded ? 'Réduire le menu' : 'Agrandir le menu'}
      >
        <Icon name={expanded ? 'arrow-left' : 'chevron-right'} size={16} />
        <span className="sidebar-toggle-label">Réduire</span>
      </button>

      <nav className="sidebar-nav" aria-label="Navigation principale">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
            title={item.label}
          >
            <Icon name={item.icon} />
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
