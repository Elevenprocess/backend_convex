// Onglets de promo de la page Leads gardés dans l'adresse de la page :
//   /leads                          → onglet « Leads »
//   /leads?onglet=promotion         → onglet « Promotion »
//   /leads?onglet=promo&promo=<id>  → onglet « Leads de « X » »
// L'onglet survit donc à une actualisation et le lien peut être partagé.
// `promo=<id>` reste dans l'adresse tant que l'onglet de la promo est ouvert,
// même quand on regarde un autre onglet (il ne se ferme qu'avec la croix).
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export type PromoView = 'leads' | 'promotions' | 'promoLeads'

export const PROMO_TAB_PARAM = 'onglet'
export const PROMO_ID_PARAM = 'promo'

export function readPromoTabs(params: URLSearchParams): { view: PromoView; promoId: string | null } {
  const promoId = params.get(PROMO_ID_PARAM) || null
  const onglet = params.get(PROMO_TAB_PARAM)
  const view: PromoView = onglet === 'promotion' ? 'promotions' : onglet === 'promo' && promoId ? 'promoLeads' : 'leads'
  return { view, promoId }
}

export function writePromoTabs(
  params: URLSearchParams,
  next: { view?: PromoView; promoId?: string | null },
): URLSearchParams {
  const current = readPromoTabs(params)
  const view = next.view ?? current.view
  const promoId = next.promoId !== undefined ? next.promoId : current.promoId
  const out = new URLSearchParams(params)
  if (promoId) out.set(PROMO_ID_PARAM, promoId)
  else out.delete(PROMO_ID_PARAM)
  const finalView = view === 'promoLeads' && !promoId ? 'promotions' : view
  if (finalView === 'leads') out.delete(PROMO_TAB_PARAM)
  else out.set(PROMO_TAB_PARAM, finalView === 'promotions' ? 'promotion' : 'promo')
  return out
}

/** Onglet courant + promo ouverte, lus et écrits dans l'adresse de la page. */
export function usePromoTabsUrl() {
  const [params, setParams] = useSearchParams()
  const { view, promoId } = readPromoTabs(params)
  const setTabs = useCallback(
    (next: { view?: PromoView; promoId?: string | null }, opts?: { replace?: boolean }) => {
      setParams((prev) => writePromoTabs(prev, next), { replace: opts?.replace ?? false })
    },
    [setParams],
  )
  const setView = useCallback((v: PromoView) => setTabs({ view: v }), [setTabs])
  return { view, promoId, setTabs, setView }
}
