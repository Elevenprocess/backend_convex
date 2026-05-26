import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../Icon'
import { useRole, useDisplayUser, type Role } from '../../lib/role'
import { useAuth } from '../../lib/auth'
import { useNavSidebar } from '../../lib/navSidebar'
import { useTheme } from '../../lib/theme'

type Item = { to: string; icon: IconName; label: string; roles?: Role[] }
type Section = { id: string; label: string; items: Item[] }

const SECTIONS: Section[] = [
  {
    id: 'espace',
    label: 'Espace',
    items: [
      { to: '/overview', icon: 'home', label: 'Overview' },
      { to: '/leads', icon: 'users', label: 'Leads' },
      { to: '/rdv', icon: 'calendar', label: 'RDV' },
    ],
  },
  {
    id: 'activite',
    label: 'Activité',
    items: [
      { to: '/notifications', icon: 'bell', label: 'Rappels' },
      { to: '/analytics', icon: 'chart', label: 'Analytics' },
      { to: '/admin/pipeline', icon: 'target', label: 'Pipeline', roles: ['admin'] },
      { to: '/suivi', icon: 'grid', label: 'Suivi', roles: ['admin', 'delivrabilite'] },
      { to: '/delivrabilite', icon: 'shield', label: 'Délivrabilité', roles: ['admin', 'delivrabilite'] },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    items: [
      { to: '/settings', icon: 'users', label: 'Équipe', roles: ['commercial'] },
      { to: '/settings', icon: 'shield', label: 'Paramètres', roles: ['admin'] },
    ],
  },
]

const SIDEBAR_STORAGE_KEY = 'ecoi.sidebar.expanded'

const ROLE_TAG: Record<Role, string> = {
  admin: 'Administration',
  setter: 'Setter',
  commercial: 'Commercial',
  delivrabilite: 'Délivrabilité',
}

export function Sidebar() {
  const role = useRole((s) => s.role)
  const user = useDisplayUser()
  const signOut = useAuth((s) => s.signOut)
  const isDark = useTheme((s) => s.isDark)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const navigate = useNavigate()
  const location = useLocation()
  const mobileOpen = useNavSidebar((s) => s.mobileOpen)
  const closeMobile = useNavSidebar((s) => s.closeMobile)

  useEffect(() => {
    closeMobile()
  }, [location.pathname, closeMobile])

  useEffect(() => {
    if (!mobileOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    return stored === null ? true : stored === 'true'
  })
  const [userMenu, setUserMenu] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded))
  }, [expanded])

  useEffect(() => {
    if (!userMenu) return
    const closeOnOutside = (event: MouseEvent) => {
      if (!userRef.current?.contains(event.target as Node)) setUserMenu(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUserMenu(false)
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [userMenu])

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({
        ...s,
        items: s.items.filter((it) => !it.roles || it.roles.includes(role)),
      })).filter((s) => s.items.length > 0),
    [role],
  )

  const handleSignOut = async () => {
    setUserMenu(false)
    await signOut()
    navigate('/', { replace: true })
  }

  const goSearch = () => navigate('/leads')

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={closeMobile}
          className="sb-mobile-backdrop"
        />
      )}
      <aside className={`app-sidebar sb ${expanded ? 'sb-expanded' : 'sb-collapsed'} ${mobileOpen ? 'sb-mobile-open' : ''}`}>
      <button
        type="button"
        className="sb-workspace"
        onClick={() => navigate('/overview')}
        title="Electro Concept OI"
      >
        <span className="sb-workspace-logo">
          <img src="/favicon.png" alt="" />
        </span>
        <span className="sb-workspace-meta">
          <span className="sb-workspace-name">Electro Concept</span>
          <span className="sb-workspace-tag">
            <span className="sb-workspace-dot" aria-hidden="true" />
            {ROLE_TAG[role] ?? role}
          </span>
        </span>
        <Icon name="chevron-down" size={13} className="sb-workspace-caret" />
      </button>

      <button type="button" className="sb-search" onClick={goSearch} title="Rechercher">
        <Icon name="search" size={14} strokeWidth={1.9} />
        <span className="sb-search-label">Rechercher…</span>
        <kbd className="sb-kbd">⌘K</kbd>
      </button>

      <div className="sb-scroll">
        {sections.map((section) => (
          <nav key={section.id} className="sb-section" aria-label={section.label}>
            <div className="sb-section-label">{section.label}</div>
            {section.items.map((item) => (
              <NavLink
                key={section.id + item.to + item.label}
                to={item.to}
                className={({ isActive }) => `sb-item ${isActive ? 'is-active' : ''}`}
                data-tip={item.label}
                title={item.label}
              >
                <span className="sb-item-icon">
                  <Icon name={item.icon} size={16} strokeWidth={1.75} />
                </span>
                <span className="sb-item-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        ))}
      </div>

      <div className="sb-user" ref={userRef}>
        <button
          type="button"
          className={`sb-user-btn ${userMenu ? 'is-open' : ''}`}
          onClick={() => setUserMenu((v) => !v)}
          title={`${user.name} — ${user.role}`}
        >
          <span className={`sb-user-avatar ${user.tint}`}>
            {user.image ? <img src={user.image} alt="" /> : user.initials}
          </span>
          <span className="sb-user-meta">
            <span className="sb-user-name">{user.name}</span>
            <span className="sb-user-role">{user.role}</span>
          </span>
          <Icon name="chevron-down" size={13} className="sb-user-caret" />
        </button>

        {userMenu && (
          <div className="sb-user-menu" role="menu">
            <button
              type="button"
              className="sb-menu-item"
              onClick={() => {
                setUserMenu(false)
                navigate('/profile')
              }}
            >
              <Icon name="users" size={14} strokeWidth={1.75} />
              <span>Profil</span>
            </button>
            <button
              type="button"
              className="sb-menu-item"
              onClick={() => {
                toggleTheme()
              }}
            >
              <Icon name={isDark ? 'sun' : 'moon'} size={14} strokeWidth={1.75} />
              <span>{isDark ? 'Thème clair' : 'Thème sombre'}</span>
            </button>
            <div className="sb-menu-sep" />
            <button type="button" className="sb-menu-item is-danger" onClick={handleSignOut}>
              <Icon name="logout" size={14} strokeWidth={1.75} />
              <span>Déconnexion</span>
            </button>
          </div>
        )}
      </div>

      <div className="sb-footer">
        <button
          type="button"
          className="sb-mini"
          onClick={toggleTheme}
          title={isDark ? 'Mode clair' : 'Mode sombre'}
          aria-label="Basculer le thème"
        >
          <Icon name={isDark ? 'sun' : 'moon'} size={13} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className="sb-mini sb-collapse"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Réduire' : 'Étendre'}
          aria-label={expanded ? 'Réduire le menu' : 'Étendre le menu'}
        >
          <Icon name={expanded ? 'arrow-left' : 'chevron-right'} size={13} strokeWidth={1.9} />
          <span className="sb-mini-label">Réduire</span>
        </button>
      </div>
    </aside>
    </>
  )
}
