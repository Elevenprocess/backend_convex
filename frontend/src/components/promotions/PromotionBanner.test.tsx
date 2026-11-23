import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromotionBanner } from './PromotionBanner'

const promo = { _id: 'p1', name: 'Black Friday', startAt: Date.parse('2026-11-22T20:00:00Z'), endAt: Date.parse('2026-11-29T19:59:59.999Z'), offer: '-15 % sur les kits', pitch: 'Dire bonjour', officeSlots: true }

describe('PromotionBanner', () => {
  it('affiche nom, dates, offre, mention bureau ; argumentaire dépliable ; filtre source', () => {
    const onSource = vi.fn()
    render(<PromotionBanner promo={promo} source="all" onSource={onSource} />)
    expect(screen.getByText('Black Friday')).toBeInTheDocument()
    expect(screen.getByText(/du 23 au 29 nov\./)).toBeInTheDocument()
    expect(screen.getByText('-15 % sur les kits')).toBeInTheDocument()
    expect(screen.getByText(/RDV au bureau possibles/)).toBeInTheDocument()
    expect(screen.queryByText('Dire bonjour')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /argumentaire/i }))
    expect(screen.getByText('Dire bonjour')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Anciens prospects' }))
    expect(onSource).toHaveBeenCalledWith('statut')
  })
  it('showSourceFilter=false masque le sélecteur', () => {
    render(<PromotionBanner promo={promo} source="all" onSource={vi.fn()} showSourceFilter={false} />)
    expect(screen.queryByRole('button', { name: 'Anciens prospects' })).not.toBeInTheDocument()
  })
})
