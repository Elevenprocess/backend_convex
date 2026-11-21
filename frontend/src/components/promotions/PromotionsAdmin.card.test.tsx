// frontend/src/components/promotions/PromotionsAdmin.card.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const promo = { _id: 'p1', name: 'Black Friday', startAt: 0, endAt: Date.now() + 86400000, archived: false, status: 'en_cours', webhookKey: 'abc123' }

vi.mock('../../lib/promotionsApi', () => ({
  usePromotionsList: () => [promo],
  usePromotionStats: () => undefined,
  useLegacyPreview: () => undefined,
  archivePromotion: vi.fn(), attachLegacy: vi.fn(), backfillPromotion: vi.fn(), ensurePromotionWebhook: vi.fn(),
}))
vi.mock('./PromotionForm', () => ({ PromotionForm: () => null, LEGACY_STATUS_OPTIONS: [] }))

import { PromotionsAdmin } from './PromotionsAdmin'

describe('carte de promotion', () => {
  it('affiche le bouton « Copier le webhook » sur une promo en cours', () => {
    render(<PromotionsAdmin leads={[]} onOpenLeads={() => {}} />)
    expect(screen.getByText('Black Friday')).toBeTruthy()
    expect(screen.getByText('Copier le webhook')).toBeTruthy()
  })
})
