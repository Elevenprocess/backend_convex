import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Grid } from 'ldrs/react'
import 'ldrs/react/Grid.css'
import { Icon } from '../Icon'
import { useDisplayUser } from '../../lib/role'
import { useAuth } from '../../lib/auth'
import { useLeads, useRdvList } from '../../lib/hooks'
import { useNetworkActivity } from '../../lib/networkActivity'
import { useTheme } from '../../lib/theme'

type TopbarProps = {
  eyebrow?: string
  title?: string
  tabs?: { id: string; label: string }[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

export function Topbar({ eyebrow, title }: TopbarProps) {
  const user = useDisplayUser()
  const authUser = useAuth((s) => s.user)
  const isAdmin = user.role === 'admin'
  const signOut = useAuth((s) => s.signOut)
  const isDark = useTheme((s) => s.isDark)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isNotificationsPage = pathname.startsWith('/notifications')
  const inFlight = useNetworkActivity((s) => s.inFlight)
  const isLoading = inFlight > 0
  const topbarRef = useRef<HTMLElement | null>(null)
  const [openMenu, setOpenMenu] = useState<'search' | 'settings' | 'profile' | null>(null)
  const [search, setSearch] = useState('')
  const isCommercial = authUser?.role === 'commercial'
  const leadNotificationFilters = isCommercial && authUser?.id ? { assignedToId: authUser.id, limit: 250 } : { limit: 250 }
  const rdvNotificationFilters = isCommercial && authUser?.id ? { commercialId: authUser.id, limit: 200 } : { limit: 200 }
  const { data: leadsData } = useLeads(leadNotificationFilters)
  const { data: rdvsData } = useRdvList(rdvNotificationFilters)
  const [seenNotificationVersion, setSeenNotificationVersion] = useState(0)
  const notificationCount = useMemo(
    () => isNotificationsPage ? 0 : countUnreadNotifications(leadsData ?? [], rdvsData ?? [], isCommercial),
    [isNotificationsPage, isCommercial, leadsData, rdvsData, seenNotificationVersion],
  )

  useEffect(() => {
    const refreshSeenNotifications = () => setSeenNotificationVersion((version) => version + 1)
    window.addEventListener('storage', refreshSeenNotifications)
    window.addEventListener('ecoi:notifications-seen', refreshSeenNotifications)
    return () => {
      window.removeEventListener('storage', refreshSeenNotifications)
      window.removeEventListener('ecoi:notifications-seen', refreshSeenNotifications)
    }
  }, [])

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
    navigate('/', { replace: true })
  }

  const runSearch = () => {
    const q = search.trim()
    if (!q) return
    setOpenMenu(null)
    navigate(`/leads?search=${encodeURIComponent(q)}`)
  }

  return (
    <header ref={topbarRef} className="app-topbar">
      <div className="min-w-0 max-w-[320px] pr-4">
        {(eyebrow || title) && (
          <div className="min-w-0">
            {eyebrow && <span className="eyebrow block">{eyebrow}</span>}
            {title && <h2 className="text-base font-bold truncate">{title}</h2>}
          </div>
        )}
      </div>

      <div className="main-nav-center flex items-center justify-center" aria-live="polite" aria-label={isLoading ? 'Chargement en cours' : 'Aucun chargement'}>
        <PageLoader animated={isLoading} />
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

        {isAdmin && (
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
              title="Paramètres"
              className={`topbar-action ${openMenu === 'settings' ? 'active' : ''}`}
            >
              <Icon name="settings" size={16} />
            </button>
            {openMenu === 'settings' && (
              <DropdownFrame className="w-56 p-1.5">
                <SbMenuItem icon="settings" label="Paramètres SaaS" onClick={() => { setOpenMenu(null); navigate('/settings') }} />
                <SbMenuItem icon="chart" label="Analytics" onClick={() => { setOpenMenu(null); navigate('/analytics') }} />
              </DropdownFrame>
            )}
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'profile' ? null : 'profile')}
            title={`${user.name} — ${user.role}`}
            className={`topbar-profile ${openMenu === 'profile' ? 'active' : ''}`}
          >
            <span className={`w-8 h-8 ${user.tint} flex items-center justify-center rounded-full text-sm font-bold border border-white/80 shadow-sm overflow-hidden`}>
              {user.image ? <img src={user.image} alt="Profil" className="w-full h-full object-cover" /> : user.initials}
            </span>
            <Icon name="chevron-down" size={13} className="text-faint" />
          </button>
          {openMenu === 'profile' && (
            <DropdownFrame className="w-64 p-1.5">
              <div className="profile-menu-head">
                <div className={`w-10 h-10 ${user.tint} flex items-center justify-center rounded-xl font-bold text-sm shadow-sm border border-white/80 overflow-hidden`}>
                  {user.image ? <img src={user.image} alt="Profil" className="w-full h-full object-cover" /> : user.initials}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{user.name}</div>
                  <div className="text-[11px] text-faint capitalize truncate">{user.role}</div>
                </div>
              </div>
              <SbMenuItem icon="users" label="Mon profil" onClick={() => { setOpenMenu(null); navigate('/profile') }} />
              <SbMenuItem
                icon={isDark ? 'sun' : 'moon'}
                label={isDark ? 'Thème clair' : 'Thème sombre'}
                onClick={() => { toggleTheme() }}
              />
              <div className="sb-menu-sep" />
              <SbMenuItem icon="logout" label="Se déconnecter" danger onClick={handleSignOut} />
            </DropdownFrame>
          )}
        </div>
      </div>
    </header>
  )
}

function countUnreadNotifications(
  leads: { id: string; status: string; createdAt: string; updatedAt?: string; nextCallbackAt: string | null }[],
  rdvs: { id: string; status: string; result?: string | null; scheduledAt: string; createdAt?: string; updatedAt?: string }[],
  commercial = false,
): number {
  const seen = readSeenNotificationIds()
  const ids = commercial ? activeCommercialNotificationIds(rdvs) : activeNotificationIds(leads, rdvs)
  return ids.filter((id) => !seen.has(id)).length
}

function activeNotificationIds(
  leads: { id: string; status: string; createdAt: string; nextCallbackAt: string | null }[],
  rdvs: { id: string; status: string; scheduledAt: string }[],
): string[] {
  const now = Date.now()
  const in10Min = now + 10 * 60 * 1000
  const in24h = now - 24 * 60 * 60 * 1000
  const ids: string[] = []

  for (const lead of leads) {
    const callbackAt = lead.nextCallbackAt ? new Date(lead.nextCallbackAt).getTime() : null
    if (callbackAt && callbackAt <= now && (lead.status === 'a_rappeler' || lead.status === 'relance' || lead.nextCallbackAt)) {
      ids.push(`callback-late-${lead.id}`)
    } else if (callbackAt && callbackAt <= in10Min && callbackAt > now) {
      ids.push(`callback-soon-${lead.id}`)
    } else if (callbackAt && lead.status === 'a_rappeler') {
      ids.push(`callback-planned-${lead.id}`)
    }

    if (lead.status === 'nouveau' && new Date(lead.createdAt).getTime() >= in24h) {
      ids.push(`new-lead-${lead.id}`)
    }
  }

  for (const rdv of rdvs) {
    const scheduled = new Date(rdv.scheduledAt).getTime()
    if (rdv.status === 'planifie' && scheduled > now && scheduled <= in10Min) {
      ids.push(`rdv-soon-${rdv.id}`)
    }
  }

  return ids
}

function activeCommercialNotificationIds(
  rdvs: { id: string; status: string; result?: string | null; scheduledAt: string; createdAt?: string; updatedAt?: string }[],
): string[] {
  const now = Date.now()
  const in10Min = now + 10 * 60 * 1000
  const in24h = now + 24 * 60 * 60 * 1000
  const since24h = now - 24 * 60 * 60 * 1000
  const ids: string[] = []

  for (const rdv of rdvs) {
    const scheduled = new Date(rdv.scheduledAt).getTime()
    const created = rdv.createdAt ? new Date(rdv.createdAt).getTime() : 0
    const updated = rdv.updatedAt ? new Date(rdv.updatedAt).getTime() : 0
    if (rdv.status === 'planifie' && scheduled > now && scheduled <= in10Min) {
      ids.push(`commercial-rdv-soon-${rdv.id}`)
    } else if (rdv.status === 'planifie' && scheduled > now && scheduled <= in24h) {
      ids.push(`commercial-rdv-upcoming-${rdv.id}`)
    }

    if (created >= since24h) {
      ids.push(`commercial-rdv-new-${rdv.id}`)
    } else if (updated >= since24h && !(rdv.status === 'planifie' && !rdv.result)) {
      ids.push(`commercial-pipeline-${rdv.id}`)
    }
  }

  return ids
}

function readSeenNotificationIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('ecoi.seenNotificationIds') ?? '[]')) } catch { return new Set() }
}

// PageLoader : affiche un Grid de ldrs au centre de la Topbar.
// Quand `animated` est vrai (une requête API est en vol), l'animation tourne.
// Sinon, on rend une grille 4×4 statique aux mêmes dimensions/couleur — le loader
// reste visible mais immobile (par demande utilisateur).
function PageLoader({ animated }: { animated: boolean }) {
  const size = 32
  const color = 'var(--color-or-dark, #b9883f)'
  if (animated) {
    return <Grid size={size} speed={1.4} color={color} />
  }
  const dot = size * 0.1
  const gap = size * 0.16
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(4, ${dot}px)`,
        gridAutoRows: `${dot}px`,
        gap: `${gap}px`,
        width: size,
        height: size * 0.8,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.55,
      }}
    >
      {Array.from({ length: 16 }).map((_, i) => (
        <span
          key={i}
          style={{
            width: dot,
            height: dot,
            borderRadius: '50%',
            backgroundColor: color,
          }}
        />
      ))}
    </div>
  )
}

function DropdownFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`topbar-menu ${className ?? ''}`}>
      <span className="topbar-menu-arrow" />
      {children}
    </div>
  )
}

function SbMenuItem({ icon, label, onClick, danger = false }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sb-menu-item ${danger ? 'is-danger' : ''}`}
    >
      <Icon name={icon} size={14} strokeWidth={1.75} />
      <span className="truncate">{label}</span>
    </button>
  )
}
