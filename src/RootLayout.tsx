import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CallBubble } from './components/call/CallBubble'
import { PersistentCallSidebar } from './components/call/PersistentCallSidebar'
import { SidebarRevealPill } from './components/call/SidebarRevealPill'
import { PersistentLeadSidebar } from './components/leads/PersistentLeadSidebar'
import { ClipboardToast } from './components/ClipboardToast'
import { useAuth } from './lib/auth'
import { useRealtimeSocket } from './lib/realtime'
import { useTheme } from './lib/theme'

export function RootLayout() {
  useRealtimeSocket()
  useAuthSessionKeeper()
  const hydrateTheme = useTheme((s) => s.hydrateTheme)

  useEffect(() => {
    hydrateTheme()
  }, [hydrateTheme])

  return (
    <>
      <ScrollReset />
      <Outlet />
      <PersistentLeadSidebar />
      <PersistentCallSidebar />
      <SidebarRevealPill />
      <CallBubble />
      <ClipboardToast />
    </>
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

    const interval = window.setInterval(refreshSession, 60 * 60 * 1000)
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
