import { addDays, startOfDay, startOfWeek, toDateInputValue } from './period'
import type { EvolutionGranularity } from './evolutionAxis'

// Logique d'entonnoir : Nouveau Lead → RDV planifiés → Ventes. La série du
// milieu est alimentée par la donnée « qualifiés » (clé historique `qualified`).
export type LeadEvolutionSeriesKey = 'leads' | 'qualified' | 'signed'
// Un lead/client rattaché à un bucket, avec l'agent qui lui est associé
// (setter pour les qualifiés, commercial pour les ventes). `t` = horodatage
// réel de l'événement (arrivée / 1re prise de RDV / signature).
export type LeadEvolutionItem = { id: string; t: number; name: string; sub?: string | null; agent?: string | null }
// Événements datés fournis par la page pour lister les leads/clients d'un bucket.
export type LeadEvolutionEvents = { qualified?: LeadEvolutionItem[]; signed?: LeadEvolutionItem[] }
export type LeadEvolutionPoint = { key: string; t: number; date: string; label: string; leads: number; qualified: number; signed: number; qualifiedItems?: LeadEvolutionItem[]; signedItems?: LeadEvolutionItem[] }
export type EvolutionDailyInput = { date: string; label: string; calls: number; rdv: number; signed: number; ca: number; classified: number; qualified?: number; newLeads?: number }
export type EvolutionHourlyInput = { date: string; hour: number; label: string; calls: number }
export type EvolutionRange = { from: string; to: string; days: number }

const HOUR_WINDOW_START = 0
const HOUR_WINDOW_END = 23

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
  // Dates d'ARRIVÉE des nouveaux leads (createdAt en ms) sur la période. Quand
  // fournies, la série « leads » est recalculée par comptage RÉEL des arrivées
  // dans chaque bucket (heure/jour/…) → le graph montre l'arrivée des leads,
  // y compris par heure, au lieu d'une répartition au prorata des appels.
  newLeadMs?: number[],
  // Événements datés (leads qualifiés / ventes) avec l'agent associé : rattachés
  // à chaque bucket pour la liste au survol. En vue horaire, ils remplacent aussi
  // le comptage prorata par un comptage réel (badge = longueur de la liste).
  events?: LeadEvolutionEvents,
): LeadEvolutionPoint[] {
  // Le backend pré-remplit tous les buckets de la plage à 0, y compris ceux PAS ENCORE COMMENCÉS
  // (heures à venir d'aujourd'hui…). On les exclut : sinon ils s'empilent à 0 contre le bord droit
  // de l'axe live et la courbe plonge verticalement au lieu de s'arrêter au dernier point réel.
  const nowMs = Date.now()
  const withArrival = (points: LeadEvolutionPoint[]) => applyEventItems(applyLeadArrival(points, granularity, newLeadMs), granularity, events)

  if (granularity === 'hour') {
    // Journée pleine 00h→23h : on génère les 24 buckets du jour (le backend ne
    // fournit les appels que 8h–21h, mais l'arrivée des leads peut tomber à
    // n'importe quelle heure). Poids d'appels repris si dispo, sinon 0.
    // day = jour LOCAL (toDateInputValue), surtout PAS dateKey (slice ISO UTC) :
    // pour un fuseau à l'est, minuit local tombe la veille en UTC → mauvais jour
    // → les buckets ne couvrent plus les arrivées du jour (courbe à 0).
    const day = toDateInputValue(new Date(range.from))
    // Totaux du jour repris de la série QUOTIDIENNE quand elle couvre la journée :
    // `totals` vient de KPI basés sur le statut ACTUEL des leads (rétroactifs, ils
    // regonflent les journées passées), alors que daily est ancrée sur des événements
    // datés → le même jour affiche le même chiffre en vue plage et en vue journée.
    const dayPoint = daily.find((p) => p.date === day)
    const dayTotals = dayPoint
      ? { leads: dayPoint.newLeads ?? dayPoint.classified, qualified: dayPoint.qualified ?? dayPoint.rdv, signed: dayPoint.signed }
      : totals
    const callsByKey = new Map(hourlyCalls.map((p) => [`${p.date}-${p.hour}`, p.calls]))
    const allHours: EvolutionHourlyInput[] = []
    for (let hour = HOUR_WINDOW_START; hour <= HOUR_WINDOW_END; hour++) {
      allHours.push({ date: day, hour, label: `${dayLabel(day)} ${hour}h`, calls: callsByKey.get(`${day}-${hour}`) ?? 0 })
    }
    // Mode live (aujourd'hui) : on s'arrête à l'heure en cours. Jour passé : 24h pleines.
    const activeHours = allHours
      .filter((point) => new Date(`${point.date}T${String(point.hour).padStart(2, '0')}:00:00`).getTime() <= nowMs)
      .sort((a, b) => hourKey(a).localeCompare(hourKey(b)))
    if (activeHours.length > 0) {
      return withArrival(distributeTotalsAcrossHours(activeHours, dayTotals))
    }
    // Pas d'heures démarrées → on retombe sur la vue jour.
  }

  const rangeStart = dateKey(range.from)
  const rangeEnd = dateKey(range.to)
  // Bucket « commencé » = son jour de début est ≤ maintenant (point.date = début du bucket
  // pour jour/semaine/mois) ; on garde le bucket en cours, on jette ceux du futur.
  const hasStarted = (point: { date: string }) => new Date(`${point.date}T00:00:00`).getTime() <= nowMs
  const inRange = daily
    .filter((point) => point.date >= rangeStart && point.date <= rangeEnd)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (granularity === 'week') return withArrival(bucketEvolution(inRange, weekBucket).filter(hasStarted))
  if (granularity === 'month') return withArrival(bucketEvolution(inRange, monthBucket).filter(hasStarted))

  // day
  return withArrival(inRange.filter(hasStarted).map((point) => ({
    key: point.date,
    t: new Date(`${point.date}T12:00:00`).getTime(),
    date: point.date,
    label: point.label || dayLabel(point.date),
    leads: point.newLeads ?? point.classified,
    qualified: point.qualified ?? point.rdv,
    signed: point.signed,
  })))
}

/** Fenêtre temporelle [début, fin) couverte par un point selon la granularité. */
function bucketRangeMs(point: LeadEvolutionPoint, granularity: EvolutionGranularity): [number, number] {
  if (granularity === 'hour') return [point.t, point.t + 3_600_000]
  const start = startOfDay(new Date(`${point.date}T12:00:00`)).getTime()
  if (granularity === 'week') return [start, start + 7 * 86_400_000]
  if (granularity === 'month') {
    const d = new Date(`${point.date}T12:00:00`)
    return [start, new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()]
  }
  return [start, start + 86_400_000]
}

/** Recalcule la série « leads » par comptage réel des arrivées dans chaque bucket. */
function applyLeadArrival(points: LeadEvolutionPoint[], granularity: EvolutionGranularity, newLeadMs?: number[]): LeadEvolutionPoint[] {
  if (!newLeadMs || newLeadMs.length === 0) return points
  return points.map((point) => {
    const [start, end] = bucketRangeMs(point, granularity)
    let leads = 0
    for (const t of newLeadMs) if (t >= start && t < end) leads += 1
    return { ...point, leads }
  })
}

/**
 * Rattache à chaque bucket la liste des leads qualifiés / ventes qui y tombent
 * (par horodatage réel de l'événement) pour l'affichage au survol. En vue
 * HORAIRE, où le comptage backend est réparti au prorata des appels (synthétique),
 * on remplace `qualified`/`signed` par le comptage RÉEL → le badge du tooltip
 * égale toujours la longueur de la liste montrée. Les autres granularités gardent
 * les agrégats backend (source de vérité, événementiels) mais reçoivent la liste.
 */
function applyEventItems(points: LeadEvolutionPoint[], granularity: EvolutionGranularity, events?: LeadEvolutionEvents): LeadEvolutionPoint[] {
  if (!events || (!events.qualified && !events.signed)) return points
  return points.map((point) => {
    const [start, end] = bucketRangeMs(point, granularity)
    const inBucket = (arr: LeadEvolutionItem[]) => arr.filter((e) => e.t >= start && e.t < end).sort((a, b) => a.t - b.t)
    const qualifiedItems = events.qualified ? inBucket(events.qualified) : undefined
    const signedItems = events.signed ? inBucket(events.signed) : undefined
    const next: LeadEvolutionPoint = { ...point, qualifiedItems, signedItems }
    if (granularity === 'hour') {
      if (qualifiedItems) next.qualified = qualifiedItems.length
      if (signedItems) next.signed = signedItems.length
    }
    return next
  })
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
    const newLeads = point.newLeads ?? point.classified
    const existing = buckets.get(bucket.key)
    if (existing) {
      existing.leads += newLeads
      existing.qualified += qualified
      existing.signed += point.signed
    } else {
      buckets.set(bucket.key, { ...bucket, leads: newLeads, qualified, signed: point.signed })
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
