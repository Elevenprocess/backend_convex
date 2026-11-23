// Onglets de promo de la page Leads (admin et setter).
import { useState } from 'react'
import { formatPromotionRange, promotionLeads, type ActivePromotion } from '../../lib/promotions'

type PromoLeadRef = { promotionId?: string | null; promotionSource?: 'tag' | 'statut' | null }

/** Onglet façon navigateur avec une croix pour le fermer. */
export function ClosableTab({ label, active, onSelect, onClose }: {
  label: string
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  return (
    <span className={`pill-tab inline-flex items-center gap-1.5 !pr-1.5 ${active ? '!bg-text !text-white' : 'bg-or-tint border border-or/30 text-or-dark'}`}>
      <button type="button" onClick={onSelect} className="font-semibold">{label}</button>
      <button type="button" aria-label={`Fermer l'onglet ${label}`} onClick={onClose}
        className="flex h-4 w-4 items-center justify-center rounded-full text-[13px] leading-none opacity-70 hover:opacity-100 hover:bg-black/10">×</button>
    </span>
  )
}

/** Onglet « Promotion » du setter : choix de la promo dont on veut voir les leads. */
export function SetterPromotionPicker({ promos, leads, onOpen }: {
  promos: ActivePromotion[]
  leads: PromoLeadRef[]
  onOpen: (p: ActivePromotion) => void
}) {
  return (
    <div className="flex-grow overflow-auto px-4 sm:px-8 pt-4 pb-8">
      <p className="mb-3 text-sm text-muted">Choisis une promotion pour voir ses prospects.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {promos.map((p) => {
          const n = promotionLeads(leads, p._id, 'all').length
          return (
            <button key={p._id} type="button" onClick={() => onOpen(p)}
              className="rounded-[18px] border border-or/30 bg-or-tint p-4 text-left transition hover:border-or hover:shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-widest text-or-dark">Promotion en cours</div>
              <div className="text-lg font-black text-text">{p.name}</div>
              <div className="text-xs text-muted">{formatPromotionRange(p.startAt, p.endAt)}</div>
              {p.offer && <p className="mt-2 text-sm font-semibold text-text">{p.offer}</p>}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-muted">{n} prospect{n > 1 ? 's' : ''}</span>
                <span className="font-bold text-or-dark">Voir les leads →</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}


/** Copie le lien de l'onglet ouvert (adresse de la page, onglet compris). */
export function CopyPromoLinkButton() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Lien de cet onglet :', window.location.href)
    }
  }
  return (
    <button type="button" onClick={copy} title="Copier le lien de cet onglet"
      className="pill-tab ml-auto bg-white border border-line text-muted hover:text-text">
      {copied ? 'Lien copié ✓' : '🔗 Copier le lien'}
    </button>
  )
}
