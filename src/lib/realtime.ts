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
    const url = realtimeBaseUrl()
    console.log('[ws] connecting to', url)
    const socket: Socket = io(url, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => console.log('[ws] connected sid=', socket.id, 'transport=', socket.io.engine.transport.name))
    socket.on('connect_error', (e) => console.warn('[ws] connect_error:', e.message))
    socket.on('disconnect', (r) => console.warn('[ws] disconnect:', r))
    socket.on('lead:new', (lead) => {
      console.log('[ws] lead:new', (lead as { id?: string })?.id)
      notifyRealtimeRefresh({ event: 'lead:new', paths: ['/leads'] })
    })
    socket.on('lead:updated', () => notifyRealtimeRefresh({ event: 'lead:updated', paths: ['/leads'] }))
    socket.on('call-log:new', () => notifyRealtimeRefresh({ event: 'call-log:new', paths: ['/call-logs', '/leads'] }))
    socket.on('rdv:new', () => notifyRealtimeRefresh({ event: 'rdv:new', paths: ['/rdv', '/leads', '/ghl-calendar/free-slots'] }))
    socket.on('notification:new', (notification: { title?: string; body?: string; id?: string }) => {
      console.log('[ws] notification:new', notification)
      notifyRealtimeRefresh({ event: 'notification:new', paths: ['/leads', '/rdv', '/call-logs'] })
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notification.title) {
        new Notification(notification.title, { body: notification.body, tag: notification.id })
      }
    })

    return () => {
      console.log('[ws] disconnecting')
      socket.disconnect()
    }
  }, [])
}
