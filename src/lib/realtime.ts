import { useEffect } from 'react'
import { io, type Socket } from 'socket.io-client'
import { API_BASE } from './api'

export const REALTIME_REFRESH_EVENT = 'ecoi:realtime-refresh'

export type RealtimeRefreshPayload = {
  paths: string[]
  event: string
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

    socket.on('lead:new', () => notifyRealtimeRefresh({ event: 'lead:new', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('lead:updated', () => notifyRealtimeRefresh({ event: 'lead:updated', paths: ['/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('call-log:new', () => notifyRealtimeRefresh({ event: 'call-log:new', paths: ['/call-logs', '/leads', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('rdv:new', () => notifyRealtimeRefresh({ event: 'rdv:new', paths: ['/rdv', '/leads', '/ghl-calendar/free-slots', '/ghl-calendar/events', '/analytics/summary', '/analytics/funnel'] }))
    socket.on('notification:new', (notification: { title?: string; body?: string; id?: string }) => {
      notifyRealtimeRefresh({ event: 'notification:new', paths: ['/leads', '/rdv', '/call-logs', '/analytics/summary', '/analytics/funnel'] })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notification.title) {
        try {
          new Notification(notification.title, { body: notification.body, tag: notification.id, requireInteraction: true, silent: false } as NotificationOptions)
        } catch {
          try { new Notification(notification.title, { body: notification.body, tag: notification.id }) } catch { /* notification bloquée par le navigateur */ }
        }
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [])
}
