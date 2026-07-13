import { describe, it, expect } from 'vitest'
import { canEditPayment } from './role'
import type { Role } from './role'

// Accès à l'onglet « Mode de paiement » de la page projet : l'équipe
// délivrabilité (delivrabilite / responsable_technique / back_office) a le
// même accès complet que admin/finances — aligné sur les gardes backend
// (payments.controller.ts).
describe('canEditPayment', () => {
  const allowed: Role[] = ['admin', 'finances', 'delivrabilite', 'responsable_technique', 'back_office']
  const denied: Role[] = ['setter', 'setter_lead', 'commercial', 'commercial_lead', 'technicien']

  it.each(allowed.map((r) => [r]))('%s peut éditer le suivi de paiement', (role) => {
    expect(canEditPayment(role)).toBe(true)
  })

  it.each(denied.map((r) => [r]))('%s ne peut pas éditer le suivi de paiement', (role) => {
    expect(canEditPayment(role)).toBe(false)
  })

  it('rôle absent (session pas encore chargée) → pas d’édition', () => {
    expect(canEditPayment(undefined)).toBe(false)
  })
})
