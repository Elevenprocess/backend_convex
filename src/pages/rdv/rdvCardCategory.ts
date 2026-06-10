import type { RdvResponse } from '../../lib/types'

// Catégorie de couleur d'une carte RDV dans le calendrier. Voir le design :
// docs/superpowers/specs/2026-06-10-calendrier-couleurs-rdv-design.md
export type RdvCardCategory = 'devis' | 'debrief' | 'avenir' | 'absent' | 'autre'

// Premier cas qui matche. nowIso et scheduledAt sont des ISO → compare lexicographique.
export function rdvCardCategory(rdv: RdvResponse, nowIso: string): RdvCardCategory {
  if (rdv.hasDevisEnAttente) return 'devis'
  if (rdv.debriefFilledAt != null) return 'debrief'
  if (rdv.status === 'no_show' || rdv.status === 'annule' || rdv.status === 'reporte') return 'autre'
  if (rdv.scheduledAt >= nowIso) return 'avenir'
  return 'absent'
}
