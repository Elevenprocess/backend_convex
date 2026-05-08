import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'
import { useDisplayUser } from '../../lib/role'
import { useAuth } from '../../lib/auth'
import { useLeads, useRdvList } from '../../lib/hooks'

type TopbarProps = {
  eyebrow?: string
  title?: string
  tabs?: { id: string; label: string }[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

const MAIN_NAV_TABS = [
  { id: 'overview', label: 'Overview', to: '/overview' },
  { id: 'performance', label: 'Performance', to: '/analytics' },
  { id: 'activity', label: 'Activité', to: '/analytics' },
  { id: 'leads', label: 'Leads', to: '/leads' },
]

function currentMainTab(pathname: string, activeTab?: string): string {
  if (activeTab && MAIN_NAV_TABS.some((tab) => tab.id === activeTab)) return activeTab
  if (pathname.startsWith('/leads')) return 'leads'
  if (pathname.startsWith('/analytics')) return 'performance'
  return 'overview'
}

export function Topbar({ eyebrow, title, activeTab, onTabChange }: TopbarProps) {
  const user = useDisplayUser()
  const signOut = useAuth((s) => s.signOut)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const mainActiveTab = currentMainTab(pathname, activeTab)
  const topbarRef = useRef<HTMLElement | null>(null)
  const [openMenu, setOpenMenu] = useState<'search' | 'settings' | 'profile' | null>(null)
  const [search, setSearch] = useState('')
  const { data: leadsData } = useLeads({ limit: 3000 })
  const { data: rdvsData } = useRdvList({ limit: 1000 })
  const notificationCount = useMemo(() => countActiveNotifications(leadsData ?? [], rdvsData ?? []), [leadsData, rdvsData])

  useEffect(() => {
    if (!openMenu) return

    const closeOnOutside = (event: MouseEvent) => {
      if (!topbarRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenu])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const runSearch = () => {
    const q = search.trim()
    if (!q) return
    setOpenMenu(null)
    navigate(`/leads?search=${encodeURIComponent(q)}`)
  }

  return (
    <header ref={topbarRef} className="app-topbar">
      <div className="flex items-center gap-6 min-w-0">
        {(eyebrow || title) && (
          <div className="min-w-0">
            {eyebrow && <span className="eyebrow block">{eyebrow}</span>}
            {title && <h2 className="text-base font-bold truncate">{title}</h2>}
          </div>
        )}
        <div className="flex bg-or-tint p-1 rounded-full">
          {MAIN_NAV_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`pill-tab ${mainActiveTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                onTabChange?.(tab.id)
                navigate(tab.to)
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-actions">
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'search' ? null : 'search')}
            className={`topbar-action ${openMenu === 'search' ? 'active' : ''}`}
            title="Recherche"
          >
            <Icon name="search" size={16} />
          </button>
          {openMenu === 'search' && (
            <DropdownFrame className="w-[min(360px,calc(100vw-112px))] p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="menu-icon-badge"><Icon name="search" size={14} /></span>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-faint">Recherche rapide</div>
                  <div className="text-xs text-muted">Trouver un lead par nom, ville ou téléphone</div>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                  placeholder="Nom, ville, téléphone…"
                  className="topbar-search-input"
                />
                <button onClick={runSearch} className="btn-primary px-4 rounded-xl text-xs shadow-sm">OK</button>
              </div>
            </DropdownFrame>
          )}
        </div>

        <button
          onClick={() => navigate('/notifications')}
          className="topbar-action relative"
          title="Notifications"
        >
          <Icon name="bell" size={16} />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-rouille text-white rounded-full ring-2 ring-white text-[10px] leading-4 font-bold">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>

        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
            title="Paramètres"
            className={`topbar-action ${openMenu === 'settings' ? 'active' : ''}`}
          >
            <Icon name="settings" size={16} />
          </button>
          {openMenu === 'settings' && (
            <DropdownFrame className="w-64 p-2">
              <MenuButton icon="settings" label="Paramètres" hint="Préférences du SaaS" onClick={() => { setOpenMenu(null); navigate('/settings') }} />
              <MenuButton icon="chart" label="Analytics" hint="Performance & pipeline" onClick={() => { setOpenMenu(null); navigate('/analytics') }} />
              <div className="h-px bg-line-soft my-2 mx-2" />
              <MenuButton icon="logout" label="Se déconnecter" danger onClick={handleSignOut} />
            </DropdownFrame>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'profile' ? null : 'profile')}
            title={`${user.name} — ${user.role}`}
            className={`topbar-profile ${openMenu === 'profile' ? 'active' : ''}`}
          >
            <span className={`w-8 h-8 ${user.tint} flex items-center justify-center rounded-full text-sm font-bold border border-white/80 shadow-sm`}>{user.initials}</span>
            <Icon name="chevron-down" size={13} className="text-faint" />
          </button>
          {openMenu === 'profile' && (
            <DropdownFrame className="w-72 p-3">
              <div className="profile-menu-head">
                <div className={`w-11 h-11 ${user.tint} flex items-center justify-center rounded-2xl font-bold shadow-sm border border-white/80`}>{user.initials}</div>
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{user.name}</div>
                  <div className="text-xs text-faint capitalize">{user.role}</div>
                </div>
              </div>
              <MenuButton icon="home" label="Dashboard" hint="Vue d’ensemble" onClick={() => { setOpenMenu(null); navigate('/overview') }} />
              <MenuButton icon="users" label="Tous les leads" hint="Liste complète" onClick={() => { setOpenMenu(null); navigate('/leads') }} />
              <MenuButton icon="settings" label="Compte & paramètres" hint="Profil utilisateur" onClick={() => { setOpenMenu(null); navigate('/settings') }} />
            </DropdownFrame>
          )}
        </div>
      </div>
    </header>
  )
}

function countActiveNotifications(
  leads: { status: string; createdAt: string; nextCallbackAt: string | null }[],
  rdvs: { status: string; scheduledAt: string }[],
): number {
  const now = Date.now()
  const in10Min = now + 10 * 60 * 1000
  const in24h = now - 24 * 60 * 60 * 1000
  const leadCount = leads.filter((lead) => {
    const callbackAt = lead.nextCallbackAt ? new Date(lead.nextCallbackAt).getTime() : null
    const hasCallback = callbackAt != null && (lead.status === 'a_rappeler' || lead.status === 'relance' || Boolean(lead.nextCallbackAt))
    const hasUrgentOrPlannedCallback = hasCallback && (callbackAt <= in10Min || lead.status === 'a_rappeler')
    const isNewLead = lead.status === 'nouveau' && new Date(lead.createdAt).getTime() >= in24h
    return hasUrgentOrPlannedCallback || isNewLead
  }).length
  const rdvCount = rdvs.filter((rdv) => {
    const scheduled = new Date(rdv.scheduledAt).getTime()
    return rdv.status === 'planifie' && scheduled > now && scheduled <= in10Min
  }).length
  return leadCount + rdvCount
}

function DropdownFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`topbar-menu ${className ?? ''}`}>
      <span className="topbar-menu-arrow" />
      {children}
    </div>
  )
}

function MenuButton({ icon, label, hint, onClick, danger = false }: { icon: Parameters<typeof Icon>[0]['name']; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`menu-button ${danger ? 'danger' : ''}`}
    >
      <span className="menu-icon-badge"><Icon name={icon} size={15} /></span>
      <span className="min-w-0 text-left">
        <span className="block truncate">{label}</span>
        {hint && <span className="block text-[11px] font-medium text-faint truncate">{hint}</span>}
      </span>
    </button>
  )
}
