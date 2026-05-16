import { useLocation } from 'react-router-dom'
import { SplitPanel } from '../SplitPanel'
import { useLead, useUsers } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import { useLeadSidebar } from '../../lib/leadSidebar'
import type { UserResponse } from '../../lib/types'

export function PersistentLeadSidebar() {
  const location = useLocation()
  const role = useAuth((s) => s.user?.role)
  const selectedLeadId = useLeadSidebar((s) => s.selectedLeadId)
  const sidebarOpen = useLeadSidebar((s) => s.sidebarOpen)
  const closeSidebar = useLeadSidebar((s) => s.closeSidebar)
  const hashPath = window.location.hash.replace(/^#/, '') || location.pathname
  const sidebarAllowed = hashPath.startsWith('/leads') || hashPath.startsWith('/call')
  const shouldRenderSidebar = Boolean(
    role &&
    selectedLeadId &&
    sidebarOpen &&
    location.pathname !== '/overview' &&
    !(role === 'setter' && location.pathname === '/analytics') &&
    !location.pathname.startsWith('/team/setters') &&
    sidebarAllowed,
  )
  const { data: lead, loading, refetch } = useLead(shouldRenderSidebar ? selectedLeadId ?? undefined : undefined)
  const { data: usersList } = useUsers()

  if (!shouldRenderSidebar) return null
  if (!lead) {
    if (!loading) return null
    return (
      <aside className="fixed top-0 right-0 bottom-0 z-[140] w-[460px] max-w-[92vw] border-l border-line bg-white/95 p-6 shadow-2xl">
        <button type="button" onClick={closeSidebar} className="absolute right-4 top-4 text-xl text-muted hover:text-text">×</button>
        <div className="eyebrow text-or">Lead</div>
        <h2 className="mt-1 text-xl font-black">Ouverture du détail…</h2>
        <div className="mt-6 space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-cream-darker" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-cream-darker" />
          <div className="h-28 animate-pulse rounded-2xl bg-cream-darker" />
        </div>
      </aside>
    )
  }

  const userMap = new Map<string, UserResponse>()
  for (const user of usersList ?? []) userMap.set(user.id, user)

  return (
    <SplitPanel
      lead={lead}
      userMap={userMap}
      onClose={closeSidebar}
      onSaved={refetch}
      className="fixed top-0 right-0 bottom-0 z-[140] shadow-2xl bg-white/95"
    />
  )
}
