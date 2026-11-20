// frontend/src/components/promotions/PromotionsAdmin.test.tsx
import { describe, expect, it } from 'vitest'
import { validatePromotionForm, EMPTY_PROMOTION_FORM } from './PromotionForm'

describe('validatePromotionForm', () => {
  it('exige nom, dates ordonnées et tag ou statut', () => {
    expect(validatePromotionForm({ ...EMPTY_PROMOTION_FORM })).toMatch(/nom/i)
    const base = { ...EMPTY_PROMOTION_FORM, name: 'BF', startDay: '2026-11-23', endDay: '2026-11-29' }
    expect(validatePromotionForm(base)).toMatch(/tag ou au moins un statut/i)
    expect(validatePromotionForm({ ...base, tag: 'black friday' })).toBeNull()
    expect(validatePromotionForm({ ...base, legacyStatuses: ['perdu'] })).toBeNull()
    expect(validatePromotionForm({ ...base, tag: 'x', endDay: '2026-11-20' })).toMatch(/fin/i)
  })
})
