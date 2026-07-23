import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Grid } from 'ldrs/react'
import 'ldrs/react/Grid.css'
import { Icon } from '../Icon'
import { useDisplayUser } from '../../lib/role'
import { useAuth } from '../../lib/auth'
import { useLeads, useRdvList, useSharedLeads } from '../../lib/hooks'
import { convexAuthEnabled } from '../../lib/convex'
import { useNetworkActivity } from '../../lib/networkActivity'
import { useNavSidebar } from '../../lib/navSidebar'
import { useTheme } from '../../lib/theme'
import { leadSearchPath } from '../../lib/leadPaths'

type TopbarProps = {
  eyebrow?: string
  title?: string
  tabs?: { id: string; label: string }[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

export function Topbar(_props: TopbarProps) {
  const user = useDisplayUser()
  const authUser = useAuth((s) => s.user)
  const isAdmin = user.role === 'admin' || user.role === 'commercial_lead'
  const signOut = useAuth((s) => s.signOut)
  const isDark = useTheme((s) => s.isDark)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isNotificationsPage = pathname.startsWith('/notifications')
  const inFlight = useNetworkActivity((s) => s.inFlight)
  const isLoading = inFlight > 0
  const openMobileNav = useNavSidebar((s) => s.openMobile)
  const topbarRef = useRef<HTMLElement | null>(null)
  const [openMenu, setOpenMenu] = useState<'search' | 'settings' | 'profile' | null>(null)
  const [search, setSearch] = useState('')
  const isCommercial = authUser?.role === 'commercial'
  const isCommercialTeam = isCommercial || authUser?.role === 'commercial_lead'
  const leadNotificationFilters = isCommercial && authUser?.id ? { assignedToId: authUser.id, limit: 250 } : { limit: 250 }
  const rdvNotificationFilters = isCommercial && authUser?.id ? { commercialId: authUser.id, limit: 200 } : { limit: 200 }
  // Rôles non commerciaux : la liste vient du drain partagé monté dans
  // RequireAuth — la Topbar re-montait sinon un abonnement complet à chaque
  // navigation. Le commercial garde sa liste scopée (assignedToId).
  const sharedLeads = useSharedLeads()
  const ownLeadsNeeded = isCommercial || !convexAuthEnabled
  const { data: ownLeadsData } = useLeads(ownLeadsNeeded ? leadNotificationFilters : null)
  const leadsData = ownLeadsNeeded ? ownLeadsData : sharedLeads.data
  const { data: rdvsData } = useRdvList(rdvNotificationFilters)
  const [seenNotificationVersion, setSeenNotificationVersion] = useState(0)
  const notificationCount = useMemo(
    () => isNotificationsPage ? 0 : countUnreadNotifications(leadsData ?? [], rdvsData ?? [], isCommercialTeam),
    [isNotificationsPage, isCommercialTeam, leadsData, rdvsData, seenNotificationVersion],
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
    navigate(leadSearchPath(authUser?.role, q))
  }

  return (
    <header ref={topbarRef} className="app-topbar">
      <div className="min-w-0 flex items-center gap-2 max-w-[60%] md:max-w-[420px] pr-2 sm:pr-4">
        <button
          type="button"
          className="topbar-burger"
          onClick={openMobileNav}
          aria-label="Ouvrir le menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
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
                  <div className="text-xs text-muted">Trouver un prospect par nom, ville ou téléphone</div>
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
                <SbMenuItem icon="chart" label="Analyse" onClick={() => { setOpenMenu(null); navigate('/analytics') }} />
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
  leads: { id: string; status: string; createdAt: string; updatedAt?: string; lastStageChangeAt?: string | null; nextCallbackAt: string | null }[],
  rdvs: { id: string; status: string; result?: string | null; scheduledAt: string; createdAt?: string; updatedAt?: string; debriefFilledAt?: string | null }[],
  commercial = false,
): number {
  const seen = readSeenNotificationIds()
  // Côté commercial (commercial + commercial_lead) : uniquement les 3 notifs
  // commerciales (nouveau qualifié, RDV reporté, débrief à faire).
  const ids = commercial ? activeCommercialNotificationIds(leads, rdvs) : activeNotificationIds(leads, rdvs)
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

// IDs des 3 notifications commerciales (commercial + commercial_lead). Doit
// rester aligné avec buildCommercialNotifications dans pages/Notifications.tsx.
function activeCommercialNotificationIds(
  leads: { id: string; status: string; lastStageChangeAt?: string | null; updatedAt?: string }[],
  rdvs: { id: string; status: string; scheduledAt: string; debriefFilledAt?: string | null }[],
): string[] {
  const now = Date.now()
  const in24h = now + 24 * 60 * 60 * 1000
  const since48h = now - 48 * 60 * 60 * 1000
  const ids: string[] = []

  for (const lead of leads) {
    if (lead.status !== 'qualifie') continue
    const ref = lead.lastStageChangeAt ?? lead.updatedAt
    const changedAt = ref ? new Date(ref).getTime() : 0
    if (changedAt >= since48h) ids.push(`commercial-lead-qualified-${lead.id}`)
  }

  for (const rdv of rdvs) {
    const scheduled = new Date(rdv.scheduledAt).getTime()
    if (rdv.status === 'reporte' && scheduled > now && scheduled <= in24h) {
      ids.push(`commercial-rdv-reporte-${rdv.id}`)
    }
    if (rdv.status === 'honore' && !rdv.debriefFilledAt) {
      ids.push(`commercial-debrief-${rdv.id}`)
    }
  }

  return ids
}

function readSeenNotificationIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('ecoi.seenNotificationIds') ?? '[]')) } catch { return new Set() }
}

// PageLoader : Grid de ldrs animé en continu au centre de la Topbar.
// Aucun état d'arrêt — l'animation tourne en boucle indépendamment des requêtes.
function PageLoader(_props: { animated: boolean }) {
  const size = 32
  const color = 'var(--color-or-dark, #1F7857)'
  return <Grid size={size} speed={1.4} color={color} />
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
