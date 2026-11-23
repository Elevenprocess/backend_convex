// Places restantes du funnel d'inscription Black Friday (site invitation, base
// Convex d'Erwan), lues EN DIRECT : la même table de places que voient les
// prospects. Velora réserve dans cette table à la validation d'un RDV bureau
// (action promotions.confirmOfficeSlot → funnel /velora/reserver).
import { ConvexClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { useEffect, useState } from 'react'

export const FUNNEL_CONVEX_URL: string =
  (import.meta.env.VITE_FUNNEL_CONVEX_URL as string | undefined) ?? 'https://handsome-ram-995.eu-west-1.convex.cloud'

/** À partir de combien de places restantes on prévient (comme le funnel). */
export const FEW_PLACES = 5

export type FunnelSlot = { jour: string; heure: number; capacite: number; restantes: number }
/** « 2026-11-27 9 » → places restantes. */
export type FunnelAvailability = Map<string, number>

export const slotKey = (day: string, hour: number) => `${day} ${hour}`

export function toAvailability(slots: readonly FunnelSlot[]): FunnelAvailability {
  return new Map(slots.map((s) => [slotKey(s.jour, s.heure), Math.max(0, s.restantes)]))
}

/** Texte d'une heure : null tant qu'il reste plus de 5 places (rien à signaler). */
export function placesLabel(left: number | undefined): string | null {
  if (left === undefined) return null
  if (left <= 0) return 'Complet'
  if (left === 1) return "Plus qu'une place"
  if (left <= FEW_PLACES) return `Plus que ${left} places`
  return null
}

/** Places restantes sur une journée (somme des heures connues), null si le funnel ne connaît pas ce jour. */
export function dayPlacesLeft(availability: FunnelAvailability | null, day: string, hours: readonly number[]): number | null {
  if (!availability) return null
  let known = false
  let total = 0
  for (const h of hours) {
    const left = availability.get(slotKey(day, h))
    if (left === undefined) continue
    known = true
    total += left
  }
  return known ? total : null
}

const disponibles = makeFunctionReference<'query', Record<string, never>, FunnelSlot[]>('creneaux:disponibles')
let client: ConvexClient | null = null

/** Abonnement temps réel aux places du funnel ; null tant que rien n'est reçu (ou si le funnel ne répond pas). */
export function useFunnelAvailability(enabled: boolean): FunnelAvailability | null {
  const [availability, setAvailability] = useState<FunnelAvailability | null>(null)
  useEffect(() => {
    if (!enabled) return
    try {
      client ??= new ConvexClient(FUNNEL_CONVEX_URL)
      return client.onUpdate(disponibles, {}, (slots) => setAvailability(toAvailability(slots ?? [])), () => setAvailability(null))
    } catch {
      return
    }
  }, [enabled])
  return enabled ? availability : null
}
