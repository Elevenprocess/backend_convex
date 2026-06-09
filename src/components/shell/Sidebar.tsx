import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../Icon'
import { useRole, useDisplayUser, type Role } from '../../lib/role'
import { useAuth } from '../../lib/auth'
import { useNavSidebar } from '../../lib/navSidebar'
import { useTheme } from '../../lib/theme'
import { leadListPath } from '../../lib/leadPaths'

type Item = { to: string; icon: IconName; label: string; roles?: Role[] }
type Section = { id: string; label: string; items: Item[]; collapsible?: boolean }

const ACQUISITION_ROLES: Role[] = ['admin', 'setter', 'setter_lead', 'commercial', 'commercial_lead']
const DELIVERY_ROLES: Role[] = ['admin', 'delivrabilite', 'responsable_technique', 'back_office']
const OPS_ROLES: Role[] = ['delivrabilite', 'responsable_technique', 'back_office']
const CALENDAR_ROLES: Role[] = [
  'admin',
  'setter',
  'setter_lead',
  'commercial',
  'commercial_lead',
  'delivrabilite',
  'responsable_technique',
  'back_office',
]
// Le commercial (vendeur individuel) n'a pas besoin d'Analytics ni de Rappels :
// sa vue est minimale (débrief + suivi de son client). Le commercial_lead
// (responsable) garde, lui, l'accès complet.
const NON_SALES_REP_ROLES: Role[] = [
  'admin',
  'setter',
  'setter_lead',
  'commercial_lead',
  'delivrabilite',
  'responsable_technique',
  'back_office',
  'technicien',
  'finances',
]

const SECTIONS: Section[] = [
  {
    id: 'espace',
    label: 'Espace',
    items: [
      { to: '/overview', icon: 'home', label: 'Overview' },
      { to: '/notifications', icon: 'bell', label: 'Rappels', roles: NON_SALES_REP_ROLES },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    items: [
      { to: '/analytics', icon: 'chart', label: 'Analytics', roles: NON_SALES_REP_ROLES },
    ],
  },
  {
    id: 'acquisition',
    label: 'Acquisition',
    collapsible: true,
    items: [
      { to: '/leads', icon: 'users', label: 'Leads', roles: ['admin', 'setter', 'setter_lead'] },
      { to: '/client', icon: 'inbox', label: 'Client', roles: ACQUISITION_ROLES },
    ],
  },
  {
    id: 'delivrabilite',
    label: 'Délivrabilité',
    collapsible: true,
    items: [
      { to: '/suivi', icon: 'grid', label: 'Delivery', roles: DELIVERY_ROLES },
      { to: '/client', icon: 'inbox', label: 'Client', roles: OPS_ROLES },
    ],
  },
  {
    id: 'calendriers',
    label: 'Calendriers',
    collapsible: true,
    items: [
      { to: '/rdv', icon: 'calendar', label: 'Calendrier RDV', roles: CALENDAR_ROLES },
      { to: '/planning', icon: 'clock', label: 'Planning', roles: DELIVERY_ROLES },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    collapsible: true,
    items: [
      { to: '/settings', icon: 'settings', label: 'Paramètres', roles: ['admin', 'commercial_lead'] },
    ],
  },
]

const SIDEBAR_STORAGE_KEY = 'ecoi.sidebar.expanded'
const SIDEBAR_SECTIONS_STORAGE_KEY = 'ecoi.sidebar.collapsedSections'

const ROLE_TAG: Record<Role, string> = {
  admin: 'Administration',
  setter: 'Setter',
  setter_lead: 'Setter Lead',
  commercial: 'Commercial',
  commercial_lead: 'Commercial Lead',
  delivrabilite: 'Délivrabilité',
  responsable_technique: 'Responsable technique',
  back_office: 'Back office',
  technicien: 'Technicien',
  finances: 'Finances',
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
  const [collapsedSections, setCollapsedSections] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    const stored = window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)
    if (!stored) return []
    try {
      const parsed = JSON.parse(stored)
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
    } catch {
      return []
    }
  })
  const [userMenu, setUserMenu] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded))
  }, [expanded])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, JSON.stringify(collapsedSections))
  }, [collapsedSections])

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

  const sections = useMemo(() => {
    if (role === 'technicien') {
      return [
        {
          id: 'technicien',
          label: 'Espace',
          items: [
            { to: '/planning', icon: 'calendar' as const, label: 'Planning' },
            { to: '/mes-dossiers', icon: 'inbox' as const, label: 'Mes dossiers' },
          ],
        },
      ]
    }
    const built = SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((it) => !it.roles || it.roles.includes(role)),
    }))
    return built.filter((s) => s.items.length > 0)
  }, [role])

  useEffect(() => {
    const activeSection = sections.find((section) => section.items.some((item) => item.to === location.pathname))
    if (!activeSection?.collapsible || !collapsedSections.includes(activeSection.id)) return
    setCollapsedSections((current) => current.filter((id) => id !== activeSection.id))
  }, [collapsedSections, location.pathname, sections])

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((current) =>
      current.includes(sectionId) ? current.filter((id) => id !== sectionId) : [...current, sectionId],
    )
  }

  const handleSignOut = async () => {
    setUserMenu(false)
    await signOut()
    navigate('/', { replace: true })
  }

  const goSearch = () => navigate(leadListPath(role))

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
        {sections.map((section) => {
          const isSectionCollapsed = expanded && section.collapsible && collapsedSections.includes(section.id)
          const bodyId = `sidebar-section-${section.id}`
          return (
            <nav
              key={section.id}
              className={`sb-section ${section.collapsible ? 'sb-section-collapsible' : ''} ${isSectionCollapsed ? 'is-collapsed' : ''}`}
              aria-label={section.label}
            >
              {section.collapsible && expanded ? (
                <button
                  type="button"
                  className="sb-section-header"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={!isSectionCollapsed}
                  aria-controls={bodyId}
                >
                  <span className="sb-section-label">{section.label}</span>
                  <Icon name="chevron-down" size={12} className="sb-section-chevron" />
                </button>
              ) : (
                <div className="sb-section-label">{section.label}</div>
              )}
              <div className="sb-section-body" id={bodyId} hidden={isSectionCollapsed}>
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
              </div>
            </nav>
          )
        })}
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
