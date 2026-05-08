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
  const base = (configured || API_BASE).replace(/\/$/, '')
  if (base.endsWith('/api')) return base.slice(0, -4)
  return base
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

    socket.on('lead:new', () => notifyRealtimeRefresh({ event: 'lead:new', paths: ['/leads'] }))
    socket.on('lead:updated', () => notifyRealtimeRefresh({ event: 'lead:updated', paths: ['/leads'] }))
    socket.on('call-log:new', () => notifyRealtimeRefresh({ event: 'call-log:new', paths: ['/call-logs', '/leads'] }))
    socket.on('notification:new', (notification: { title?: string; body?: string; id?: string }) => {
      notifyRealtimeRefresh({ event: 'notification:new', paths: ['/leads', '/rdv', '/call-logs'] })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notification.title) {
        new Notification(notification.title, { body: notification.body, tag: notification.id })
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [])
}
