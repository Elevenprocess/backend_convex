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
  const { data: lead, refetch } = useLead(selectedLeadId ?? undefined)
  const { data: usersList } = useUsers()

  if (!role) return null
  if (!selectedLeadId || !sidebarOpen) return null
  if (location.pathname === '/leads') return null
  if (location.pathname === '/overview') return null
  if (location.pathname === '/deliverability') return null
  if (location.pathname === '/analytics') return null
  if (location.pathname === '/notifications') return null
  if (location.pathname === '/settings') return null
  if (location.pathname.startsWith('/rdv')) return null
  if (role === 'setter' && location.pathname === '/analytics') return null
  if (location.pathname.startsWith('/team/setters')) return null
  if (!lead) return null

  const userMap = new Map<string, UserResponse>()
  for (const user of usersList ?? []) userMap.set(user.id, user)

  return (
    <SplitPanel
      lead={lead}
      userMap={userMap}
      onClose={closeSidebar}
      onSaved={refetch}
      className="fixed top-0 right-0 bottom-0 z-[95] shadow-2xl bg-white/95"
    />
  )
}
