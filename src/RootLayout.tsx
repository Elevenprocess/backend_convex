import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
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
import { fullName, type LeadResponse } from './lib/types'
import { leadSearchPath } from './lib/leadPaths'
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
      <SetterCallbackToastStack />
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
    return isCommercial ? buildCommercialNotifications(leadsData ?? [], rdvsData ?? []) : buildNotifications(leadsData ?? [], rdvsData ?? [])
  }, [isCommercial, leadsData, rdvsData, status, minuteTick])

  useBrowserNotifications(notifications)
}

function SetterCallbackToastStack() {
  const user = useAuth((s) => s.user)
  const status = useAuth((s) => s.status)
  const isSetter = status === 'authed' && user?.role === 'setter'
  const { data: leadsData } = useLeads(isSetter ? { limit: 250 } : null)
  const minuteTick = useMinuteTick()
  const [dismissedIds, setDismissedIds] = useStateSet('ecoi.dismissedCallbackToastIds')

  const callbacks = useMemo(() => {
    if (!isSetter) return []
    const now = Date.now()
    const horizon = now + 24 * 60 * 60 * 1000 // ne toast que les rappels en retard ou dans les prochaines 24h
    return (leadsData ?? [])
      .filter((lead) => {
        if (!lead.nextCallbackAt) return false
        if (dismissedIds.has(callbackToastKey(lead))) return false
        return lead.status === 'a_rappeler' || lead.status === 'relance'
      })
      .map((lead) => ({ lead, callbackAt: new Date(lead.nextCallbackAt!).getTime() }))
      .filter(({ callbackAt }) => Number.isFinite(callbackAt) && callbackAt <= horizon)
      .sort((a, b) => callbackToastRank(a.callbackAt, b.callbackAt, now))
      .slice(0, 8)
  }, [dismissedIds, isSetter, leadsData, minuteTick])

  if (!isSetter || callbacks.length === 0) return null

  const hiddenCount = Math.max(0, callbacks.length - 3)
  const visibleCallbacks = callbacks.slice(0, 3)

  return (
    <div className="callback-toast-stack" role="status" aria-live="polite">
      {hiddenCount > 0 && (
        <div className="callback-toast-overflow">
          +{hiddenCount} autre{hiddenCount > 1 ? 's' : ''} rappel{hiddenCount > 1 ? 's' : ''}
        </div>
      )}
      <div className="callback-toast-list">
        {visibleCallbacks.map(({ lead, callbackAt }) => (
          <CallbackToast
            key={callbackToastKey(lead)}
            lead={lead}
            callbackAt={callbackAt}
            onDismiss={() => setDismissedIds((ids) => new Set(ids).add(callbackToastKey(lead)))}
          />
        ))}
      </div>
    </div>
  )
}

function CallbackToast({ lead, callbackAt, onDismiss }: { lead: LeadResponse; callbackAt: number; onDismiss: () => void }) {
  const role = useAuth((s) => s.user?.role)
  const now = Date.now()
  const diffMs = callbackAt - now
  const isLate = diffMs <= 0
  const title = isLate ? 'Rappel à faire maintenant' : 'Rappel programmé'
  const countdown = isLate ? `En retard de ${formatDuration(Math.abs(diffMs))}` : `Appel dans ${formatDuration(diffMs)}`
  const scheduledTime = new Date(callbackAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const progress = isLate ? 100 : Math.max(4, Math.min(100, 100 - (diffMs / (24 * 60 * 60 * 1000)) * 100))

  return (
    <div className="callback-toast">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={`w-8 h-8 rounded-full ${isLate ? 'bg-rouille-tint text-rouille' : 'bg-or-tint text-or-dark'} flex items-center justify-center font-bold shrink-0`}>☎</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-text">{title}</div>
              <div className="text-xs text-muted truncate"><strong>{fullName(lead)}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</div>
            </div>
            <button className="callback-toast-close" type="button" aria-label="Fermer ce rappel" onClick={onDismiss}>×</button>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={isLate ? 'text-rouille font-semibold' : 'text-muted'}>{countdown}</span>
            <Link to={leadSearchPath(role, fullName(lead))} className="text-or-dark font-semibold hover:underline">Ouvrir</Link>
          </div>
          <div className="mt-2 text-[11px] text-faint">Heure d’appel : {scheduledTime}</div>
        </div>
      </div>
      <div className={isLate ? 'callback-toast-track late' : 'callback-toast-track'}>
        <div className="callback-toast-gauge" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

function callbackToastRank(aTime: number, bTime: number, now: number): number {
  const aRank = callbackToastPriority(aTime, now)
  const bRank = callbackToastPriority(bTime, now)
  if (aRank !== bRank) return aRank - bRank
  if (aRank === 1) return bTime - aTime
  return aTime - bTime
}

function callbackToastPriority(callbackAt: number, now: number): number {
  if (callbackAt > now && callbackAt <= now + 10 * 60 * 1000) return 0
  if (callbackAt <= now) return 1
  return 2
}

function callbackToastKey(lead: LeadResponse): string {
  return `${lead.id}:${lead.nextCallbackAt ?? ''}`
}

function useStateSet(storageKey: string): [Set<string>, (updater: (ids: Set<string>) => Set<string>) => void] {
  const [ids, setIds] = useMemoState(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(storageKey) ?? '[]')) } catch { return new Set<string>() }
  })

  const update = (updater: (ids: Set<string>) => Set<string>) => {
    setIds((current) => {
      const next = updater(new Set(current))
      localStorage.setItem(storageKey, JSON.stringify(Array.from(next).slice(-1000)))
      return next
    })
  }

  return [ids, update]
}

function useMemoState<T>(initial: () => T) {
  const [value, setValue] = useState(initial)
  return [value, setValue] as const
}

function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60000))
  useEffect(() => {
    const interval = window.setInterval(() => setTick(Math.floor(Date.now() / 60000)), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  return tick
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000))
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes ? `${hours}h ${minutes}min` : `${hours}h`
  const days = Math.floor(hours / 24)
  // Au-delà de 7 jours, l'écart est trop grand pour parler de "dans Xj" — on rend la date directement.
  if (days >= 7) {
    const target = new Date(Date.now() + ms)
    return `le ${target.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`
  }
  const remainingHours = hours % 24
  return remainingHours ? `${days}j ${remainingHours}h` : `${days}j`
}
