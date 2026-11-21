import { leadSlotView, type ActivePromotion } from '../../lib/promotions'
import { useActivePromotions } from '../../lib/promotionsApi'
import type { LeadResponse } from '../../lib/types'

type SlotLead = Pick<LeadResponse, 'externalId' | 'promotionId' | 'promotionSlotDay' | 'promotionSlotHour' | 'promotionTicket'>

/**
 * Créneau d’arrivée du lead pour la promo (pris sur le site d’inscription) et
 * bouton qui ouvre ce site pour le choisir ou le changer à sa place.
 */
export function PromotionSlotView({ lead, promos, compact = false }: { lead: SlotLead; promos: ActivePromotion[]; compact?: boolean }) {
  const view = leadSlotView(lead, promos)
  if (!view) return null
  const tone = view.hasSlot ? 'text-success' : 'text-or-dark'
  const action = view.hasSlot ? 'Changer' : 'Choisir son créneau'
  if (compact) {
    return (
      <span className={`text-[10px] font-semibold ${tone}`}>
        {view.label}
        {view.link && !view.hasSlot && (
          <a href={view.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1 underline">{action}</a>
        )}
      </span>
    )
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[12px] border border-or/30 bg-or-tint px-3 py-2">
      <span className={`text-xs font-semibold ${tone}`}>{view.label}</span>
      {view.link && (
        <a href={view.link} target="_blank" rel="noopener noreferrer"
          className={view.hasSlot ? 'text-xs font-semibold text-muted underline' : 'rounded-full bg-text px-3 py-1 text-xs font-semibold text-white'}>
          {action}
        </a>
      )}
    </div>
  )
}

/** Même affichage, branché sur les promos en cours. */
export function PromotionSlot({ lead, compact }: { lead: SlotLead; compact?: boolean }) {
  return <PromotionSlotView lead={lead} promos={useActivePromotions()} compact={compact} />
}
