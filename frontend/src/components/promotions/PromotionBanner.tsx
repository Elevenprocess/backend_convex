import { useState } from 'react'
import { formatPromotionRange, type ActivePromotion } from '../../lib/promotions'

export type PromotionSourceFilter = 'all' | 'tag' | 'statut'

const SOURCES: { key: PromotionSourceFilter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'tag', label: 'Venus pour la promo' },
  { key: 'statut', label: 'Anciens prospects' },
]

const COLLAPSED_KEY = 'ecoi.promo-banner.collapsed'

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

export function PromotionBanner({ promo, source, onSource, showSourceFilter = true }: {
  promo: ActivePromotion
  source: PromotionSourceFilter
  onSource: (s: PromotionSourceFilter) => void
  showSourceFilter?: boolean
}) {
  const [showPitch, setShowPitch] = useState(false)
  const [collapsed, setCollapsedState] = useState(readCollapsed)
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v)
    try { window.localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0') } catch { /* stockage indisponible */ }
  }

  if (collapsed) {
    const current = SOURCES.find((s) => s.key === source)
    return (
      <div className="mx-4 sm:mx-8 mt-4 inline-flex items-center gap-2 rounded-full border border-or/30 bg-or-tint px-3 py-1.5 text-xs">
        <span className="font-bold uppercase tracking-widest text-[10px] text-or-dark">Promotion</span>
        <span className="font-black text-text">{promo.name}</span>
        {showSourceFilter && source !== 'all' && current && <span className="text-muted">· {current.label}</span>}
        <button type="button" onClick={() => setCollapsed(false)} className="font-semibold text-or hover:underline">Afficher</button>
      </div>
    )
  }

  return (
    <div className="mx-4 sm:mx-8 mt-4 w-auto lg:w-1/2 lg:max-w-[640px] rounded-[18px] border border-or/30 bg-or-tint p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark">Promotion en cours</div>
          <div className="font-black text-lg text-text">{promo.name}</div>
          <div className="text-xs text-muted">{formatPromotionRange(promo.startAt, promo.endAt)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {showSourceFilter && SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSource(s.key)}
              className={`pill-tab text-xs ${source === s.key ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}
            >
              {s.label}
            </button>
          ))}
          <button type="button" onClick={() => setCollapsed(true)} className="ml-1 text-xs font-semibold text-or hover:underline">
            Masquer
          </button>
        </div>
      </div>
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
