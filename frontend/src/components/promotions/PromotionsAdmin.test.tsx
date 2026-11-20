// frontend/src/components/promotions/PromotionsAdmin.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { validatePromotionForm, EMPTY_PROMOTION_FORM } from './PromotionForm'
import { PromotionWebhookBox } from './PromotionsAdmin'
import type { PromotionRow } from '../../lib/promotionsApi'

describe('validatePromotionForm', () => {
  it('exige nom et dates ordonnées ; tag et statuts facultatifs (lien webhook)', () => {
    expect(validatePromotionForm({ ...EMPTY_PROMOTION_FORM })).toMatch(/nom/i)
    const base = { ...EMPTY_PROMOTION_FORM, name: 'BF', startDay: '2026-11-23', endDay: '2026-11-29' }
    expect(validatePromotionForm(base)).toBeNull()
    expect(validatePromotionForm({ ...base, tag: 'black friday' })).toBeNull()
    expect(validatePromotionForm({ ...base, legacyStatuses: ['perdu'] })).toBeNull()
    expect(validatePromotionForm({ ...base, endDay: '2026-11-20' })).toMatch(/fin/i)
  })
})

describe('PromotionWebhookBox', () => {
  const promo = { _id: 'p1', name: 'BF', startAt: 0, endAt: 1, archived: false, status: 'en_cours', webhookKey: 'abc123' } as PromotionRow
  it('affiche le lien et le copie', async () => {
    vi.stubEnv('VITE_CONVEX_URL', 'https://x.convex.cloud')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<PromotionWebhookBox promo={promo} />)
    const input = screen.getByLabelText('Lien webhook de la promotion') as HTMLInputElement
    expect(input.value).toMatch(/\/webhooks\/ghl\/promotion\/abc123$/)
    fireEvent.click(screen.getByText('Copier'))
    await screen.findByText('Copié ✓')
    expect(writeText).toHaveBeenCalledWith(input.value)
  })
  it('propose de créer le lien quand la promo n’en a pas', () => {
    render(<PromotionWebhookBox promo={{ ...promo, webhookKey: undefined }} />)
    expect(screen.getByText('Créer le lien webhook')).toBeTruthy()
  })
})
