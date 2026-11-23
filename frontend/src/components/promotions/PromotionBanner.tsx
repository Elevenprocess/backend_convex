import { useState } from 'react'
import { formatPromotionRange, type ActivePromotion } from '../../lib/promotions'

export type PromotionSourceFilter = 'all' | 'tag' | 'statut'

const SOURCES: { key: PromotionSourceFilter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'tag', label: 'Venus pour la promo' },
  { key: 'statut', label: 'Anciens prospects' },
]

export function PromotionBanner({ promo, source, onSource, showSourceFilter = true }: {
  promo: ActivePromotion
  source: PromotionSourceFilter
  onSource: (s: PromotionSourceFilter) => void
  showSourceFilter?: boolean
}) {
  const [showPitch, setShowPitch] = useState(false)
  return (
    <div className="mx-4 sm:mx-8 mt-4 w-auto lg:w-1/2 lg:max-w-[640px] rounded-[18px] border border-or/30 bg-or-tint p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark">Promotion en cours</div>
          <div className="font-black text-lg text-text">{promo.name}</div>
          <div className="text-xs text-muted">{formatPromotionRange(promo.startAt, promo.endAt)}</div>
        </div>
        {showSourceFilter && <div className="flex gap-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSource(s.key)}
              className={`pill-tab text-xs ${source === s.key ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}
            >
              {s.label}
            </button>
          ))}
        </div>}
      </div>
      {promo.offer && <p className="text-sm font-semibold text-text">{promo.offer}</p>}
      {promo.officeSlots && (
        <p className="text-xs text-or-dark">RDV au bureau possibles du jeudi au samedi de 8 h à 18 h, le dimanche de 8 h à 13 h{promo.officeAddress ? ` — ${promo.officeAddress}` : ''}.</p>
      )}
      {promo.pitch && (
        <div>
          <button type="button" onClick={() => setShowPitch((v) => !v)} className="text-xs font-semibold text-or hover:underline">
            {showPitch ? 'Masquer l’argumentaire' : 'Voir l’argumentaire'}
          </button>
          {showPitch && <p className="mt-1 whitespace-pre-line text-sm text-text">{promo.pitch}</p>}
        </div>
      )}
    </div>
  )
}
