import { useLocation } from 'react-router-dom'
import { SplitPanel } from '../SplitPanel'
import { CommercialLeadPanel } from './CommercialLeadPanel'
import { useLead, useLeads, useUsers } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import { useLeadSidebar } from '../../lib/leadSidebar'
import type { UserResponse } from '../../lib/types'

export function PersistentLeadSidebar() {
  const location = useLocation()
  const role = useAuth((s) => s.user?.role)
  const selectedLeadId = useLeadSidebar((s) => s.selectedLeadId)
  const sidebarOpen = useLeadSidebar((s) => s.sidebarOpen)
  const closeSidebar = useLeadSidebar((s) => s.closeSidebar)
  const sidebarAllowed = location.pathname.startsWith('/leads') || location.pathname.startsWith('/client') || location.pathname.startsWith('/call')
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
  const { data: cachedLeads } = useLeads(shouldRenderSidebar ? { limit: 500 } : null)
  const { data: usersList } = useUsers()
  const displayLead = lead ?? cachedLeads?.find((item) => item.id === selectedLeadId) ?? null

  if (!shouldRenderSidebar) return null
  if (!displayLead) {
    if (!loading) return null
    return (
      <>
        <button
          type="button"
          aria-label="Fermer"
          onClick={closeSidebar}
          className="fixed inset-0 z-[135] bg-text/40 backdrop-blur-sm md:hidden"
        />
        <aside className="fixed top-0 right-0 bottom-0 z-[140] w-full md:w-[460px] md:max-w-[92vw] border-l border-line bg-white/95 p-6 shadow-2xl">
          <button type="button" onClick={closeSidebar} className="absolute right-4 top-4 text-xl text-muted hover:text-text">×</button>
          <div className="eyebrow text-or">Lead</div>
          <h2 className="mt-1 text-xl font-black">Ouverture du détail…</h2>
          <div className="mt-6 space-y-3">
            <div className="h-4 w-2/3 animate-pulse rounded bg-cream-darker" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-cream-darker" />
            <div className="h-28 animate-pulse rounded-2xl bg-cream-darker" />
          </div>
        </aside>
      </>
    )
  }

  const userMap = new Map<string, UserResponse>()
  for (const user of usersList ?? []) userMap.set(user.id, user)

  // commercial + commercial_lead (responsable commercial) partagent la sidebar
  // riche (projets + devis + débriefs + photos + docs). Le manager travaille
  // toujours sur les leads, juste avec une vue toute l'équipe en amont.
  if (role === 'commercial' || role === 'commercial_lead') {
    return (
      <>
        <button
          type="button"
          aria-label="Fermer le débriefing"
          onClick={closeSidebar}
          className="fixed inset-0 z-[135] bg-text/40 backdrop-blur-sm md:hidden"
        />
        <CommercialLeadPanel
          lead={displayLead}
          onClose={closeSidebar}
          onSaved={refetch}
          className="fixed top-0 right-0 bottom-0 z-[140]"
        />
      </>
    )
  }

  return (
    <SplitPanel
      lead={displayLead}
      userMap={userMap}
      onClose={closeSidebar}
      onSaved={refetch}
      className="fixed top-0 right-0 bottom-0 z-[140] shadow-2xl bg-white/95"
    />
  )
}
