import { addDays, endOfDay, startOfDay, startOfWeek } from './period'
import type { EvolutionGranularity } from './evolutionAxis'

// Logique d'entonnoir : Nouveau Lead → RDV planifiés → Ventes. La série du
// milieu est alimentée par la donnée « qualifiés » (clé historique `qualified`).
export type LeadEvolutionSeriesKey = 'leads' | 'qualified' | 'signed'
export type LeadEvolutionPoint = { key: string; t: number; date: string; label: string; leads: number; qualified: number; signed: number }
export type EvolutionDailyInput = { date: string; label: string; calls: number; rdv: number; signed: number; ca: number; classified: number; qualified?: number }
export type EvolutionHourlyInput = { date: string; hour: number; label: string; calls: number }
export type EvolutionRange = { from: string; to: string; days: number }

const HOUR_WINDOW_START = 8
const HOUR_WINDOW_END = 21

// Granularité dérivée du nombre de JOURS CALENDAIRES couverts par la plage (from → to).
// 'hour' n'est valide que sur UNE journée (le domaine horaire ne couvre qu'un jour 8h–21h) ;
// dès 2 jours on reste en 'day' (axe en jours). Une semaine pleine = 7 jours → 'day'.
export function chooseGranularity(range: { from: string; to: string }): EvolutionGranularity {
  const startMs = startOfDay(new Date(range.from)).getTime()
  const endMs = startOfDay(new Date(range.to)).getTime()
  const dayCount = Math.round((endMs - startMs) / 86_400_000) + 1
  if (dayCount <= 1) return 'hour'
  if (dayCount <= 35) return 'day'
  if (dayCount <= 120) return 'week'
  return 'month'
}

/** Construit les points de la courbe d'évolution à partir des VRAIES valeurs quotidiennes du backend.
 *  - leads  = leads traités (classified) par jour
 *  - rdv / signed = comptes réels par jour
 *  Aucune synthèse « force la somme à égaler le total » : on agrège (somme) les jours réels par bucket.
 *  Le total de l'onglet (`totals`) ne sert qu'au mode horaire, où la seule donnée intra-journée
 *  disponible est le volume d'appels (on répartit alors le total de la journée au prorata des appels). */
export function buildLeadEvolutionPoints(
  daily: EvolutionDailyInput[],
  hourlyCalls: EvolutionHourlyInput[],
  range: EvolutionRange,
  granularity: EvolutionGranularity,
  totals: { leads: number; qualified: number; signed: number },
): LeadEvolutionPoint[] {
  // Le backend pré-remplit tous les buckets de la plage à 0, y compris ceux PAS ENCORE COMMENCÉS
  // (heures à venir d'aujourd'hui…). On les exclut : sinon ils s'empilent à 0 contre le bord droit
  // de l'axe live et la courbe plonge verticalement au lieu de s'arrêter au dernier point réel.
  const nowMs = Date.now()

  if (granularity === 'hour') {
    const rangeStart = startOfDay(new Date(range.from)).getTime()
    const rangeEnd = endOfDay(new Date(range.to)).getTime()
    const activeHours = hourlyCalls
      .filter((point) => point.hour >= HOUR_WINDOW_START && point.hour <= HOUR_WINDOW_END)
      .filter((point) => {
        const t = new Date(point.date).getTime()
        return t >= rangeStart && t <= rangeEnd
      })
      .filter((point) => new Date(`${point.date}T${String(point.hour).padStart(2, '0')}:00:00`).getTime() <= nowMs)
      .sort((a, b) => hourKey(a).localeCompare(hourKey(b)))
    if (activeHours.length > 0) {
      return distributeTotalsAcrossHours(activeHours, totals)
    }
    // Pas de données horaires → on retombe sur la vue jour.
  }

  const rangeStart = dateKey(range.from)
  const rangeEnd = dateKey(range.to)
  // Bucket « commencé » = son jour de début est ≤ maintenant (point.date = début du bucket
  // pour jour/semaine/mois) ; on garde le bucket en cours, on jette ceux du futur.
  const hasStarted = (point: { date: string }) => new Date(`${point.date}T00:00:00`).getTime() <= nowMs
  const inRange = daily
    .filter((point) => point.date >= rangeStart && point.date <= rangeEnd)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (granularity === 'week') return bucketEvolution(inRange, weekBucket).filter(hasStarted)
  if (granularity === 'month') return bucketEvolution(inRange, monthBucket).filter(hasStarted)

  // day
  return inRange.filter(hasStarted).map((point) => ({
    key: point.date,
    t: new Date(`${point.date}T12:00:00`).getTime(),
    date: point.date,
    label: point.label || dayLabel(point.date),
    leads: point.classified,
    qualified: point.qualified ?? point.rdv,
    signed: point.signed,
  }))
}

type Bucket = { key: string; t: number; date: string; label: string }

function weekBucket(date: string): Bucket {
  const weekStart = startOfWeek(new Date(date))
  const key = weekStart.toISOString().slice(0, 10)
  const center = addDays(weekStart, 3)
  center.setHours(12, 0, 0, 0)
  return { key, t: center.getTime(), date: key, label: `sem. ${formatDayMonth(weekStart)}` }
}

function monthBucket(date: string): Bucket {
  const monthKey = date.slice(0, 7)
  return {
    key: monthKey,
    t: new Date(`${monthKey}-15T12:00:00`).getTime(),
    date: `${monthKey}-01`,
    label: formatMonthLabel(new Date(`${monthKey}-01`)),
  }
}

/** Agrège (somme) les jours réels dans des buckets semaine/mois. */
function bucketEvolution(inRange: EvolutionDailyInput[], bucketFor: (date: string) => Bucket): LeadEvolutionPoint[] {
  const buckets = new Map<string, LeadEvolutionPoint>()
  for (const point of inRange) {
    const bucket = bucketFor(point.date)
    const qualified = point.qualified ?? point.rdv
    const existing = buckets.get(bucket.key)
    if (existing) {
      existing.leads += point.classified
      existing.qualified += qualified
      existing.signed += point.signed
    } else {
      buckets.set(bucket.key, { ...bucket, leads: point.classified, qualified, signed: point.signed })
    }
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function hourKey(point: EvolutionHourlyInput): string {
  return `${point.date}-${String(point.hour).padStart(2, '0')}`
}

/** Mode horaire : on répartit le total de la journée au prorata des appels par heure (seule donnée intra-jour). */
function distributeTotalsAcrossHours(points: EvolutionHourlyInput[], totals: { leads: number; qualified: number; signed: number }): LeadEvolutionPoint[] {
  const weights = points.map((point) => Math.max(0, point.calls))
  const leadValues = distributeIntegerTotal(totals.leads, weights)
  const qualifiedValues = distributeIntegerTotal(totals.qualified, weights)
  const signedValues = distributeIntegerTotal(totals.signed, weights)
  return points.map((point, index) => ({
    key: hourKey(point),
    t: new Date(`${point.date}T${String(point.hour).padStart(2, '0')}:00:00`).getTime(),
    date: point.date,
    label: `${dayLabel(point.date)} ${point.hour}h`,
    leads: leadValues[index] ?? 0,
    qualified: qualifiedValues[index] ?? 0,
    signed: signedValues[index] ?? 0,
  }))
}

/** Répartit un total entier au prorata des poids (plus grands restes pour le reliquat). */
function distributeIntegerTotal(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  if (weightTotal <= 0) return weights.map(() => 0)
  const raw = weights.map((weight) => (weight / weightTotal) * total)
  const values = raw.map(Math.floor)
  let remaining = total - values.reduce((sum, value) => sum + value, 0)
  raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ index }) => {
      if (remaining <= 0) return
      values[index] += 1
      remaining -= 1
    })
  return values
}

function dateKey(dateLike: string | Date): string {
  if (typeof dateLike === 'string') return dateLike.slice(0, 10)
  return dateLike.toISOString().slice(0, 10)
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
}

function formatDayMonth(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')
}
