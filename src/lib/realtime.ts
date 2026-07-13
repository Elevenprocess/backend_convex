import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from 'convex/react'
import { io, type Socket } from 'socket.io-client'
import { API_BASE } from './api'
import { shouldSurfaceNotification } from './realtimeNotify'
import { createRealtimeRefreshCoalescer, REALTIME_REFRESH_COOLDOWN_MS } from './realtimeRefreshQueue'
import { useAuth } from './auth'
import { convexAuthEnabled, convexClient } from './convex'
import { leadPresenceList, leadPresenceRelease, leadPresenceTouch } from './convexApi'

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

function useLeadLocksSocket(): ReadonlyMap<string, LeadLockInfo> {
  return useSyncExternalStore(
    (listener) => {
      leadLockSubscribers.add(listener)
      return () => leadLockSubscribers.delete(listener)
    },
    () => leadLocksSnapshot,
    () => leadLocksSnapshot,
  )
}

// Mode Convex : la présence vit dans la table leadPresence (heartbeat TTL 60 s)
// et leadPresence:list est une query réactive — chaque touch/release des autres
// onglets met la map à jour toute seule.
function useLeadLocksConvex(): ReadonlyMap<string, LeadLockInfo> {
  const rows = useQuery(leadPresenceList, {})
  return useMemo(() => {
    const map = new Map<string, LeadLockInfo>()
    for (const r of rows ?? []) {
      map.set(r.leadId, {
        leadId: r.leadId,
        setterId: r.userId,
        setterName: r.userName,
        since: new Date(r.since).toISOString(),
      })
    }
    return map as ReadonlyMap<string, LeadLockInfo>
  }, [rows])
}

export const useLeadLocks: typeof useLeadLocksSocket = convexAuthEnabled
  ? useLeadLocksConvex
  : useLeadLocksSocket

// Store globale (singleton) des utilisateurs en ligne (présence WebSocket).
// Alimentée par les events presence:* émis par le gateway backend.
const onlineUsersStore = new Set<string>()
const onlineUserSubscribers = new Set<() => void>()
let onlineUsersSnapshot: ReadonlySet<string> = onlineUsersStore

function notifyOnlineUsersChange() {
  // Nouvelle référence pour que useSyncExternalStore détecte le changement.
  onlineUsersSnapshot = new Set(onlineUsersStore)
  onlineUserSubscribers.forEach((fn) => fn())
}

// Ensemble des userId actuellement en ligne (au moins un onglet ouvert).
export function useOnlineUsers(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      onlineUserSubscribers.add(listener)
      return () => onlineUserSubscribers.delete(listener)
    },
    () => onlineUsersSnapshot,
    () => onlineUsersSnapshot,
  )
}

let activeSocket: Socket | null = null

// Heartbeat Convex : tant qu'un prospect est ouvert, on re-touch toutes les
// 25 s (TTL serveur 60 s) — un onglet fermé/crashé expire donc tout seul.
let presenceLeadId: string | null = null
let presenceTimer: number | null = null
const PRESENCE_HEARTBEAT_MS = 25_000

// Émet le verrou côté setter : on s'auto-déclare comme "je regarde ce lead".
export function emitLeadSelect(leadId: string, setterId: string, setterName: string) {
  if (!leadId || !setterId) return
  if (convexAuthEnabled) {
    if (!convexClient) return
    presenceLeadId = leadId
    void convexClient.mutation(leadPresenceTouch, { leadId }).catch(() => {})
    if (presenceTimer !== null) window.clearInterval(presenceTimer)
    presenceTimer = window.setInterval(() => {
      if (presenceLeadId && convexClient) {
        void convexClient.mutation(leadPresenceTouch, { leadId: presenceLeadId }).catch(() => {})
      }
    }, PRESENCE_HEARTBEAT_MS)
    return
  }
  activeSocket?.emit('lead:select', { leadId, setterId, setterName })
}

// Libère le verrou : on a quitté ce lead (close drawer, change lead, navigate).
export function emitLeadDeselect(leadId: string) {
  if (!leadId) return
  if (convexAuthEnabled) {
    if (presenceLeadId === leadId) {
      presenceLeadId = null
      if (presenceTimer !== null) {
        window.clearInterval(presenceTimer)
        presenceTimer = null
      }
      if (convexClient) void convexClient.mutation(leadPresenceRelease, {}).catch(() => {})
    }
    return
  }
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

// Les events du SOCKET passent par le coalesceur (le flot d'activité des autres
// utilisateurs ne doit pas déclencher un refetch par event). Les actions LOCALES
// (mutations dans hooks.ts) continuent d'appeler notifyRealtimeRefresh direct :
// l'utilisateur qui vient d'agir voit sa donnée se rafraîchir tout de suite.
const scheduleRealtimeRefresh = createRealtimeRefreshCoalescer(
  notifyRealtimeRefresh,
  REALTIME_REFRESH_COOLDOWN_MS,
)

export function useRealtimeSocket() {
  useEffect(() => {
    // Mode Convex : pas de socket NestJS — les useQuery Convex sont réactifs
    // nativement, le serveur pousse les changements tout seul.
    if (convexAuthEnabled) return
    const socket: Socket = io(realtimeBaseUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    })
    activeSocket = socket

    socket.on('lead:new', () => scheduleRealtimeRefresh({ event: 'lead:new', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('lead:updated', () => scheduleRealtimeRefresh({ event: 'lead:updated', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('call-log:new', () => scheduleRealtimeRefresh({ event: 'call-log:new', paths: ['/call-logs', '/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('rdv:new', () => scheduleRealtimeRefresh({ event: 'rdv:new', paths: ['/rdv', '/leads', '/ghl-calendar/free-slots', '/ghl-calendar/events', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('notification:new', (notification: { title?: string; body?: string; id?: string; userId?: string }) => {
      const me = useAuth.getState().user?.id ?? null
      if (!shouldSurfaceNotification(notification.userId, me)) return
      scheduleRealtimeRefresh({ event: 'notification:new', paths: ['/notifications', '/leads', '/rdv', '/call-logs', '/analytics/summary', '/analytics/funnel'] })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notification.title) {
        try {
          new Notification(notification.title, { body: notification.body, tag: notification.id, requireInteraction: true, silent: false } as NotificationOptions)
        } catch {
          try { new Notification(notification.title, { body: notification.body, tag: notification.id }) } catch { /* notification bloquée par le navigateur */ }
        }
      }
    })

    socket.on('workflow_substep:updated', () =>
      scheduleRealtimeRefresh({ event: 'workflow_substep:updated', paths: ['/substeps'] }))
    socket.on('workflow_substep:blocked', () =>
      scheduleRealtimeRefresh({ event: 'workflow_substep:blocked', paths: ['/substeps'] }))

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

    // Présence utilisateurs — qui est en ligne (un onglet ouvert) en ce moment
    socket.on('presence:snapshot', (userIds: string[]) => {
      onlineUsersStore.clear()
      for (const id of userIds) onlineUsersStore.add(id)
      notifyOnlineUsersChange()
    })
    socket.on('presence:online', (payload: { userId: string }) => {
      if (!onlineUsersStore.has(payload.userId)) {
        onlineUsersStore.add(payload.userId)
        notifyOnlineUsersChange()
      }
    })
    socket.on('presence:offline', (payload: { userId: string }) => {
      if (onlineUsersStore.delete(payload.userId)) notifyOnlineUsersChange()
    })

    return () => {
      socket.disconnect()
      activeSocket = null
      if (leadLocksStore.size > 0) {
        leadLocksStore.clear()
        notifyLeadLockChange()
      }
      if (onlineUsersStore.size > 0) {
        onlineUsersStore.clear()
        notifyOnlineUsersChange()
      }
    }
  }, [])
}
