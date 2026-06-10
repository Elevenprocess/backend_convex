import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CallBubble } from './components/call/CallBubble'
import { ChatPanel } from './components/assistant/ChatPanel'
import { PersistentCallSidebar } from './components/call/PersistentCallSidebar'
import { SidebarRevealPill } from './components/call/SidebarRevealPill'
import { PersistentLeadSidebar } from './components/leads/PersistentLeadSidebar'
import { ClipboardToast } from './components/ClipboardToast'
import { useAuth } from './lib/auth'
import { useLeads, useRdvList } from './lib/hooks'
import { useRealtimeSocket } from './lib/realtime'
import { useTheme } from './lib/theme'
import { buildCommercialNotifications, buildNotifications, useBrowserNotifications } from './pages/Notifications'

export function RootLayout() {
  useRealtimeSocket()
  useAuthSessionKeeper()
  useGlobalBrowserNotifications()
  const hydrateTheme = useTheme((s) => s.hydrateTheme)

  useEffect(() => {
    hydrateTheme()
  }, [hydrateTheme])

  return (
    <>
      <ScrollReset />
      <ViewAsBanner />
      <Outlet />
      <PersistentLeadSidebar />
      <PersistentCallSidebar />
      <SidebarRevealPill />
      <CallBubble />
      <ChatPanel />
      <ClipboardToast />
    </>
  )
}

function ViewAsBanner() {
  const viewAsUser = useAuth((s) => s.viewAsUser)
  const realUser = useAuth((s) => s.realUser)
  const exitViewAs = useAuth((s) => s.exitViewAs)
  if (!viewAsUser || !realUser) return null
  const readOnly = realUser.role === 'commercial' && viewAsUser.role === 'setter'

  const initials = viewAsUser.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  const roleLabel = viewAsUser.role.charAt(0).toUpperCase() + viewAsUser.role.slice(1)

  return (
    <div className="viewas-strip">
      <div className="viewas-strip-inner">
        <div className="viewas-left">
          <span className="viewas-dot" aria-hidden="true" />
          <span className="viewas-eyebrow">{readOnly ? 'Vue impersonnée · lecture seule' : 'Vue impersonnée'}</span>
        </div>

        <div className="viewas-center">
          <div className="viewas-avatar">
            {viewAsUser.image
              ? <img src={viewAsUser.image} alt={viewAsUser.name} />
              : <span>{initials}</span>}
          </div>
          <div className="viewas-meta">
            <span className="viewas-name">{viewAsUser.name}</span>
            <span className="viewas-role">{roleLabel}</span>
          </div>
        </div>

        <div className="viewas-right">
          <span className="viewas-admin-note">
            Connecté en tant que <strong>{realUser.name.split(' ')[0]}</strong>
          </span>
          <button onClick={exitViewAs} className="viewas-exit" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
            Quitter la vue
          </button>
        </div>
      </div>
    </div>
  )
}

function useAuthSessionKeeper() {
  const status = useAuth((s) => s.status)
  const hydrate = useAuth((s) => s.hydrate)

  useEffect(() => {
    if (status !== 'authed') return

    const refreshSession = () => {
      if (document.visibilityState === 'visible') void hydrate()
    }

    refreshSession()
    const interval = window.setInterval(refreshSession, 30 * 60 * 1000)
    window.addEventListener('focus', refreshSession)
    document.addEventListener('visibilitychange', refreshSession)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshSession)
      document.removeEventListener('visibilitychange', refreshSession)
    }
  }, [status, hydrate])
}

function ScrollReset() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0 })
      document.querySelectorAll<HTMLElement>('.overflow-auto, .overflow-y-auto, .overflow-x-auto').forEach((el) => {
        if (el.dataset.preserveScroll === 'true') return
        el.scrollTop = 0
        el.scrollLeft = 0
      })
    })
  }, [pathname])

  return null
}

function useGlobalBrowserNotifications() {
  const user = useAuth((s) => s.user)
  const status = useAuth((s) => s.status)
  const isCommercial = user?.role === 'commercial'
  const isCommercialTeam = isCommercial || user?.role === 'commercial_lead'
  const leadFilters = status === 'authed'
    ? (isCommercial && user?.id ? { assignedToId: user.id, limit: 250 } : { limit: 250 })
    : null
  const rdvFilters = status === 'authed'
    ? (isCommercial && user?.id ? { commercialId: user.id, limit: 200 } : { limit: 200 })
    : null
  const { data: leadsData } = useLeads(leadFilters)
  const { data: rdvsData } = useRdvList(rdvFilters)
  const minuteTick = useMinuteTick()
  const notifications = useMemo(() => {
    if (status !== 'authed') return []
    return isCommercialTeam ? buildCommercialNotifications(leadsData ?? [], rdvsData ?? []) : buildNotifications(leadsData ?? [], rdvsData ?? [])
  }, [isCommercialTeam, leadsData, rdvsData, status, minuteTick])

  useBrowserNotifications(notifications)
}

function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60000))
  useEffect(() => {
    const interval = window.setInterval(() => setTick(Math.floor(Date.now() / 60000)), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  return tick
}
