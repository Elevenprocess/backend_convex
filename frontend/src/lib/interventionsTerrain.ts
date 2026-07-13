import type { ClientResponse, InterventionStatus } from './types'

// Interventions « terrain » (VT + installation) dérivées des étapes des
// dossiers en suivi — la page Interventions les affiche aux côtés du SAV,
// en lecture seule (elles se pilotent depuis la fiche dossier).

export type TerrainType = 'vt' | 'installation'

/** Statuts SAV + « à venir » : étape pas encore commencée ni planifiée. */
export type TerrainStatus = InterventionStatus | 'a_venir'

export const TERRAIN_TYPE_LABEL: Record<TerrainType, string> = {
  vt: 'Visite technique',
  installation: 'Installation',
}

export type TerrainIntervention = {
  id: string // `${clientId}:${type}` — clé de liste stable
  clientId: string
  leadId: string
  type: TerrainType
  status: TerrainStatus
  /** dateRealisee si réalisée (repli datePlanifiee), sinon datePlanifiee. */
  date: string | null
  clientName: string | null
  city: string | null
  technicienNames: string[]
}

const PHASES: TerrainType[] = ['vt', 'installation']

/**
 * Étape dossier → statut « intervention » : fait → réalisée, probleme → à
 * refaire, datée ou en cours → planifiée, sinon → à venir (l'étape existe au
 * dossier mais n'a pas encore commencé). Une étape annulée n'apparaît pas.
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
      let status: TerrainStatus
      if (step.status === 'fait') status = 'realisee'
      else if (step.status === 'probleme') status = 'a_refaire'
      else if (step.datePlanifiee || step.status === 'en_cours') status = 'planifiee'
      else status = 'a_venir'
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
  return rows
}
