import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ClosableTab, SetterPromotionPicker } from './PromoTabs'

const promo = { _id: 'p1', name: 'Black Friday', startAt: Date.UTC(2026, 10, 27), endAt: Date.UTC(2026, 10, 29), offer: '-15 %' }

describe('SetterPromotionPicker', () => {
  it('affiche chaque promo avec le nombre de ses prospects et ouvre celle cliquée', () => {
    const onOpen = vi.fn()
    render(<SetterPromotionPicker promos={[promo]} leads={[{ promotionId: 'p1' }, { promotionId: 'p1' }, { promotionId: 'autre' }, {}]} onOpen={onOpen} />)
    expect(screen.getByText('Black Friday')).toBeTruthy()
    expect(screen.getByText('2 prospects')).toBeTruthy()
    fireEvent.click(screen.getByText('Voir les leads →'))
    expect(onOpen).toHaveBeenCalledWith(promo)
  })
})

describe('ClosableTab', () => {
  it('sélectionne au clic sur le libellé et se ferme avec la croix', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ClosableTab label="Leads de « Black Friday »" active={false} onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(screen.getByText('Leads de « Black Friday »'))
    expect(onSelect).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText("Fermer l'onglet Leads de « Black Friday »"))
    expect(onClose).toHaveBeenCalled()
  })
  it('clignote quand un rappel de la promo est imminent', () => {
    const { container, rerender } = render(<ClosableTab label="Promo" active={false} onSelect={() => {}} onClose={() => {}} />)
    expect(container.querySelector('.is-blinking')).toBeNull()
    rerender(<ClosableTab label="Promo" active={false} blinking onSelect={() => {}} onClose={() => {}} />)
    expect(container.querySelector('.is-blinking')).toBeTruthy()
  })
})
