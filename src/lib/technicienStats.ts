import type { ClientResponse, ClientPhaseStep, UserResponse, WorkflowStatus } from './types'

export const REFUS_VT_REASONS = ['vt_a_refaire', 'vt_invalide', 'vt_anomalie_structurelle'] as const

const EN_COURS_STATUSES: WorkflowStatus[] = ['a_faire', 'planifie', 'en_cours']

export type Periode = { from: Date; to: Date }

export type TechnicienStat = {
  technicien: UserResponse
  chargeEnCours: number
  retardOuProbleme: number
  realiseesPeriode: number
  tauxValidation: number
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isVtEnRetard(vt: ClientPhaseStep, now: Date): boolean {
  if (vt.status === 'probleme') return true
  if (vt.status !== 'planifie') return false
  const planned = parseDate(vt.datePlanifiee)
  return planned != null && planned.getTime() < now.getTime()
}

export function computeTechnicienStats(
  clients: ClientResponse[],
  techniciens: UserResponse[],
  periode: Periode,
  now: Date = new Date(),
): TechnicienStat[] {
  return techniciens.map((technicien) => {
    const own = clients.filter((c) => c.technicienVtId === technicien.id)
    let chargeEnCours = 0
    let retardOuProbleme = 0
    let realiseesPeriode = 0
    let validees = 0
    let refusees = 0

    for (const c of own) {
      const vt = c.steps.vt
      if (!vt) continue
      if (EN_COURS_STATUSES.includes(vt.status)) chargeEnCours += 1
      if (isVtEnRetard(vt, now)) retardOuProbleme += 1

      const realisee = parseDate(vt.dateRealisee)
      const inPeriode = realisee != null && realisee >= periode.from && realisee <= periode.to
      if (inPeriode && vt.status === 'fait') {
        realiseesPeriode += 1
        validees += 1
      }
      if (inPeriode && vt.problemReason && (REFUS_VT_REASONS as readonly string[]).includes(vt.problemReason)) {
        refusees += 1
      }
    }

    const totalOutcomes = validees + refusees
    const tauxValidation = totalOutcomes === 0 ? 0 : Math.round((validees / totalOutcomes) * 100)
    return { technicien, chargeEnCours, retardOuProbleme, realiseesPeriode, tauxValidation }
  })
}

export type StageCounts = Record<WorkflowStatus, number>
export type TerrainPipeline = { vt: StageCounts; installation: StageCounts }

function emptyCounts(): StageCounts {
  return { a_faire: 0, planifie: 0, en_cours: 0, fait: 0, probleme: 0, en_attente: 0, annule: 0 }
}

export function computeTerrainPipeline(clients: ClientResponse[]): TerrainPipeline {
  const vt = emptyCounts()
  const installation = emptyCounts()
  for (const c of clients) {
    if (c.steps.vt) vt[c.steps.vt.status] += 1
    if (c.steps.installation) installation[c.steps.installation.status] += 1
  }
  return { vt, installation }
}

export function selectUnassignedVt(clients: ClientResponse[]): ClientResponse[] {
  return clients.filter((c) => {
    if (c.technicienVtId) return false
    const vt = c.steps.vt
    return vt ? vt.status !== 'fait' && vt.status !== 'annule' : true
  })
}

export type MonthlyTerrainPoint = {
  month: string      // 'YYYY-MM'
  vtCount: number
  installCount: number
}

/**
 * Agrège les VT faites et installations faites par mois calendaire.
 *
 * Fenêtre : les 12 derniers mois glissants (mois courant inclus).
 * Seuls les mois ayant au moins 1 événement (vt ou install fait) sont inclus.
 * Les étapes `fait` dont `dateRealisee` est null sont ignorées.
 *
 * @param clients - liste complète des dossiers
 * @returns tableau trié chronologiquement (plus ancien → plus récent)
 */
export function computeMonthlyTerrain(clients: ClientResponse[]): MonthlyTerrainPoint[] {
  const vtMap: Record<string, number> = {}
  const installMap: Record<string, number> = {}

  for (const c of clients) {
    const vt = c.steps.vt
    if (vt?.status === 'fait' && vt.dateRealisee) {
      const m = vt.dateRealisee.slice(0, 7)
      vtMap[m] = (vtMap[m] ?? 0) + 1
    }
    const inst = c.steps.installation
    if (inst?.status === 'fait' && inst.dateRealisee) {
      const m = inst.dateRealisee.slice(0, 7)
      installMap[m] = (installMap[m] ?? 0) + 1
    }
  }

  // Union de toutes les clés présentes
  const allMonths = Array.from(new Set([...Object.keys(vtMap), ...Object.keys(installMap)]))
  allMonths.sort()

  return allMonths.map((month) => ({
    month,
    vtCount: vtMap[month] ?? 0,
    installCount: installMap[month] ?? 0,
  }))
}
