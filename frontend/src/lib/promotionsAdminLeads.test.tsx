import { describe, expect, it } from 'vitest'
import { useEffect, useMemo, useRef, useState } from 'react'
import { render, act } from '@testing-library/react'
import { activePromotionIds, pruneSelectedIds, withoutActivePromotionLeads, type ActivePromotion } from './promotions'

type L = { id: string; promotionId?: string | null }

describe('pruneSelectedIds', () => {
  it('renvoie la même référence quand aucun id n\'est retiré', () => {
    const cur = ['a', 'b']
    expect(pruneSelectedIds(cur, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(cur)
  })
  it('retire les ids absents', () => {
    expect(pruneSelectedIds(['a', 'z'], [{ id: 'a' }])).toEqual(['a'])
  })
})

// Reproduit le schéma de LeadsAdmin : promo en cours + effet de nettoyage de la sélection.
const promo: ActivePromotion = { _id: 'p1', name: 'P', startAt: 0, endAt: 1 }
const EMPTY: L[] = []
let renders = 0
function Harness({ data, memo = true }: { data: L[] | undefined; memo?: boolean }) {
  renders += 1
  const activePromos = useRef([promo]).current
  const ids = useMemo(() => activePromotionIds(activePromos), [activePromos])
  const allLeads = data ?? EMPTY
  const memoized = useMemo(() => withoutActivePromotionLeads(allLeads, ids), [allLeads, ids])
  const leads = memo ? memoized : withoutActivePromotionLeads(allLeads, ids)
  const [sel, setSel] = useState<string[]>(['a'])
  useEffect(() => { setSel((cur) => pruneSelectedIds(cur, leads)) }, [leads])
  return <div>{sel.length}</div>
}

describe('LeadsAdmin avec promo en cours', () => {
  it('ne boucle pas : nombre de rendus borné', () => {
    renders = 0
    const data: L[] = [{ id: 'a' }, { id: 'b', promotionId: 'p1' }]
    const { rerender } = render(<Harness data={data} />)
    act(() => { rerender(<Harness data={data} />) })
    expect(renders).toBeLessThan(10)
  })
  it('ne boucle pas même si leads change de référence à chaque rendu (effet idempotent)', () => {
    renders = 0
    render(<Harness data={[{ id: 'a' }, { id: 'b', promotionId: 'p1' }]} memo={false} />)
    expect(renders).toBeLessThan(10)
  })
  it('ne boucle pas non plus pendant le chargement (data undefined)', () => {
    renders = 0
    render(<Harness data={undefined} />)
    expect(renders).toBeLessThan(10)
  })
})
