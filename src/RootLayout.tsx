import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CallBubble } from './components/call/CallBubble'
import { PersistentCallSidebar } from './components/call/PersistentCallSidebar'
import { SidebarRevealPill } from './components/call/SidebarRevealPill'
import { PersistentLeadSidebar } from './components/leads/PersistentLeadSidebar'
import { ClipboardToast } from './components/ClipboardToast'
import { useRealtimeSocket } from './lib/realtime'

export function RootLayout() {
  useRealtimeSocket()

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
