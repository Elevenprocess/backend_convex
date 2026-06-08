import { useEffect, useSyncExternalStore } from 'react'
import { io, type Socket } from 'socket.io-client'
import { API_BASE } from './api'
import { shouldSurfaceNotification } from './realtimeNotify'
import { useAuth } from './auth'

export const REALTIME_REFRESH_EVENT = 'ecoi:realtime-refresh'

export type RealtimeRefreshPayload = {
  paths: string[]
  event: string
}

export type LeadLockInfo = {
  leadId: string
  setterId: string
  setterName: string
  since: string
}

// Store globale (singleton) des verrous "un setter regarde ce lead". Le socket
// alimente cette map et un useSyncExternalStore expose la valeur aux composants.
const leadLocksStore = new Map<string, LeadLockInfo>()
const leadLockSubscribers = new Set<() => void>()
let leadLocksSnapshot: ReadonlyMap<string, LeadLockInfo> = leadLocksStore

function notifyLeadLockChange() {
  // Crée une nouvelle référence pour que React re-rend (useSyncExternalStore
  // compare par identité).
  leadLocksSnapshot = new Map(leadLocksStore)
  leadLockSubscribers.forEach((fn) => fn())
}

export function useLeadLocks(): ReadonlyMap<string, LeadLockInfo> {
  return useSyncExternalStore(
    (listener) => {
      leadLockSubscribers.add(listener)
      return () => leadLockSubscribers.delete(listener)
    },
    () => leadLocksSnapshot,
    () => leadLocksSnapshot,
  )
}

let activeSocket: Socket | null = null

// Émet le verrou côté setter : on s'auto-déclare comme "je regarde ce lead".
export function emitLeadSelect(leadId: string, setterId: string, setterName: string) {
  if (!leadId || !setterId) return
  activeSocket?.emit('lead:select', { leadId, setterId, setterName })
}

// Libère le verrou : on a quitté ce lead (close drawer, change lead, navigate).
export function emitLeadDeselect(leadId: string) {
  if (!leadId) return
  activeSocket?.emit('lead:deselect', { leadId })
}

function realtimeBaseUrl(): string {
  const configured = import.meta.env.VITE_REALTIME_URL as string | undefined
  const rawBase = (configured || API_BASE).replace(/\/$/, '')
  const apiBase = API_BASE.replace(/\/$/, '')
  const safeBase = isMixedContentUrl(rawBase) ? apiBase : rawBase
  const base = safeBase.endsWith('/api') ? safeBase.slice(0, -4) : safeBase
  return base
}

function isMixedContentUrl(url: string): boolean {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return false
  try { return new URL(url).protocol === 'http:' } catch { return false }
}

export function notifyRealtimeRefresh(payload: RealtimeRefreshPayload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<RealtimeRefreshPayload>(REALTIME_REFRESH_EVENT, { detail: payload }))
}

export function useRealtimeSocket() {
  useEffect(() => {
    const socket: Socket = io(realtimeBaseUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    })
    activeSocket = socket

    socket.on('lead:new', () => notifyRealtimeRefresh({ event: 'lead:new', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('lead:updated', () => notifyRealtimeRefresh({ event: 'lead:updated', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('call-log:new', () => notifyRealtimeRefresh({ event: 'call-log:new', paths: ['/call-logs', '/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('rdv:new', () => notifyRealtimeRefresh({ event: 'rdv:new', paths: ['/rdv', '/leads', '/ghl-calendar/free-slots', '/ghl-calendar/events', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('notification:new', (notification: { title?: string; body?: string; id?: string; userId?: string }) => {
      const me = useAuth.getState().user?.id ?? null
      if (!shouldSurfaceNotification(notification.userId, me)) return
      notifyRealtimeRefresh({ event: 'notification:new', paths: ['/notifications', '/leads', '/rdv', '/call-logs', '/analytics/summary', '/analytics/funnel'] })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notification.title) {
        try {
          new Notification(notification.title, { body: notification.body, tag: notification.id, requireInteraction: true, silent: false } as NotificationOptions)
        } catch {
          try { new Notification(notification.title, { body: notification.body, tag: notification.id }) } catch { /* notification bloquée par le navigateur */ }
        }
      }
    })

    socket.on('workflow_substep:updated', () =>
      notifyRealtimeRefresh({ event: 'workflow_substep:updated', paths: ['/substeps'] }))
    socket.on('workflow_substep:blocked', () =>
      notifyRealtimeRefresh({ event: 'workflow_substep:blocked', paths: ['/substeps'] }))

    // Presence locks setter — un autre setter regarde ce lead
    socket.on('lead:locks-snapshot', (locks: LeadLockInfo[]) => {
      leadLocksStore.clear()
      for (const l of locks) leadLocksStore.set(l.leadId, l)
      notifyLeadLockChange()
    })
    socket.on('lead:locked', (lock: LeadLockInfo) => {
      leadLocksStore.set(lock.leadId, lock)
      notifyLeadLockChange()
    })
    socket.on('lead:unlocked', (payload: { leadId: string }) => {
      if (leadLocksStore.delete(payload.leadId)) notifyLeadLockChange()
    })

    return () => {
      socket.disconnect()
      activeSocket = null
      if (leadLocksStore.size > 0) {
        leadLocksStore.clear()
        notifyLeadLockChange()
      }
    }
  }, [])
}
