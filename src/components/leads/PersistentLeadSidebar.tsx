import { useLocation } from 'react-router-dom'
import { SplitPanel } from '../SplitPanel'
import { useLead, useUsers } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import { isLeadSidebarExcludedPath, useLeadSidebar } from '../../lib/leadSidebar'
import type { UserResponse } from '../../lib/types'

export function PersistentLeadSidebar() {
  const location = useLocation()
  const role = useAuth((s) => s.user?.role)
  const selectedLeadId = useLeadSidebar((s) => s.selectedLeadId)
  const clearLead = useLeadSidebar((s) => s.clearLead)
  const { data: lead, refetch } = useLead(selectedLeadId ?? undefined)
  const { data: usersList } = useUsers()

  if (!role) return null
  if (!selectedLeadId) return null
  if (isLeadSidebarExcludedPath(location.pathname)) return null
  if (!lead) return null

  const userMap = new Map<string, UserResponse>()
  for (const user of usersList ?? []) userMap.set(user.id, user)

  return (
    <SplitPanel
      lead={lead}
      userMap={userMap}
      onClose={clearLead}
      onSaved={refetch}
      className="fixed top-0 right-0 bottom-0 z-[95] shadow-2xl bg-white/95"
    />
  )
}
