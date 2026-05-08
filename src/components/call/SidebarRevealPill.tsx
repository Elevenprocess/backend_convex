import { useLocation } from 'react-router-dom'
import { Icon } from '../Icon'
import { useCall } from '../../lib/call'

/**
 * Petite pastille fixée sur le bord droit de l'écran pour ré-ouvrir le
 * panneau contextuel d'appel quand l'utilisateur l'a réduit manuellement.
 * Visible uniquement pendant un appel actif lié à un lead, hors /call/split.
 */
export function SidebarRevealPill() {
  const { active, leadId, sidebarMinimized, expandSidebar } = useCall()
  const location = useLocation()

  if (!active) return null
  if (!leadId || leadId === 'manual') return null
  if (!sidebarMinimized) return null
  if (location.pathname === '/call/split') return null

  return (
    <button
      onClick={expandSidebar}
      className="fixed top-1/2 right-0 -translate-y-1/2 z-[90] bg-or text-white rounded-l-2xl pl-3 pr-2 py-3 shadow-lg flex items-center gap-2 hover:opacity-95"
      title="Rouvrir le panneau d'appel"
    >
      <Icon name="users" size={16} />
    </button>
  )
}
