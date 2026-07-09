import type { ClientResponse, InterventionStatus } from './types'

// Interventions « terrain » (VT + installation) dérivées des étapes des
// dossiers en suivi — la page Interventions les affiche aux côtés du SAV,
// en lecture seule (elles se pilotent depuis la fiche dossier).

export type TerrainType = 'vt' | 'installation'

export const TERRAIN_TYPE_LABEL: Record<TerrainType, string> = {
  vt: 'Visite technique',
  installation: 'Installation',
}

export type TerrainIntervention = {
  id: string // `${clientId}:${type}` — clé de liste stable
  clientId: string
  leadId: string
  type: TerrainType
  status: InterventionStatus
  /** dateRealisee si réalisée (repli datePlanifiee), sinon datePlanifiee. */
  date: string | null
  clientName: string | null
  city: string | null
  technicienNames: string[]
}

const PHASES: TerrainType[] = ['vt', 'installation']

/**
 * Étape dossier → statut « intervention » : fait → réalisée, probleme → à
 * refaire, sinon planifiée si une date est posée. Une étape a_faire sans date
 * ou annulée n'est pas une intervention.
 */
export function buildTerrainInterventions(
  clients: ClientResponse[],
  usersById?: Map<string, string>,
): TerrainIntervention[] {
  const rows: TerrainIntervention[] = []
  for (const c of clients) {
    for (const type of PHASES) {
      const step = c.steps[type]
      if (!step || step.status === 'annule') continue
      let status: InterventionStatus
      if (step.status === 'fait') status = 'realisee'
      else if (step.status === 'probleme') status = 'a_refaire'
      else if (step.datePlanifiee) status = 'planifiee'
      else continue
      const poseLeadName = c.poseTeamLeadId ? usersById?.get(c.poseTeamLeadId) : undefined
      rows.push({
        id: `${c.id}:${type}`,
        clientId: c.id,
        leadId: c.leadId,
        type,
        status,
        date: status === 'realisee' ? (step.dateRealisee ?? step.datePlanifiee) : step.datePlanifiee,
        clientName: c.lead.fullName,
        city: c.lead.city,
        technicienNames:
          type === 'vt' ? c.techniciens.map((t) => t.name) : poseLeadName ? [poseLeadName] : [],
      })
    }
  }
  // Plus récentes/prochaines en tête ; sans date en queue.
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}
