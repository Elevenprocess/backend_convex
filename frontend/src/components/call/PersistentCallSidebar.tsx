import { useLocation } from 'react-router-dom'
import { SplitPanel } from '../SplitPanel'
import { useCall } from '../../lib/call'
import { useLead } from '../../lib/hooks'

/**
 * Sidebar persistante affichée pendant un appel actif, hors de la page
 * /call/split (qui a déjà son propre SplitPanel inline). L'utilisateur peut
 * la masquer manuellement via le bouton réduire ; elle disparaît
 * automatiquement au raccrochage.
 */
export function PersistentCallSidebar() {
  const { active, leadId, sidebarMinimized, minimizeSidebar } = useCall()
  const location = useLocation()
  const { data: lead } = useLead(active && leadId && leadId !== 'manual' ? leadId : undefined)

  if (!active) return null
  if (!leadId || leadId === 'manual') return null
  if (sidebarMinimized) return null
  if (location.pathname === '/call/split') return null
  if (!lead) return null

  return (
    <SplitPanel
      lead={lead}
      defaultTab="notes"
      onClose={minimizeSidebar}
      className="fixed top-0 right-0 bottom-0 z-[90] shadow-2xl bg-white/95"
    />
  )
}
