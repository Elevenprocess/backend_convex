import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PromotionSlotView } from './PromotionSlot'

const promo = { _id: 'p1', name: 'Black Friday 2026', startAt: 0, endAt: 1, slotBookingUrl: 'https://invitation.exemple.re/' }
const base = { externalId: 'c1', promotionId: 'p1', promotionSlotDay: null, promotionSlotHour: null, promotionTicket: null }

describe('PromotionSlotView', () => {
  it('sans créneau : « Pas encore de créneau » et bouton vers le site, dans un nouvel onglet', () => {
    render(<PromotionSlotView lead={base} promos={[promo]} />)
    expect(screen.getByText('Pas encore de créneau')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Choisir son créneau' })
    expect(link).toHaveAttribute('href', 'https://invitation.exemple.re/?c=c1&setter=1')
    expect(link).toHaveAttribute('target', '_blank')
  })
  it('avec créneau : jour, heure, billet et lien « Changer »', () => {
    render(<PromotionSlotView lead={{ ...base, promotionSlotDay: '2026-11-27', promotionSlotHour: 14, promotionTicket: 'BF-0012' }} promos={[promo]} />)
    expect(screen.getByText('Créneau : vendredi 27, 14 h, billet BF-0012')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Changer' })).toBeInTheDocument()
  })
  it('lead hors promo : rien', () => {
    const { container } = render(<PromotionSlotView lead={{ ...base, promotionId: null }} promos={[promo]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
