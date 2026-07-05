import { ConvexReactClient } from 'convex/react'

// Client Convex (backend parallèle ECOI_convex, projet velora).
// Optionnel : sans VITE_CONVEX_URL, l'app fonctionne uniquement sur l'API NestJS.
const url = import.meta.env.VITE_CONVEX_URL as string | undefined

export const convexClient = url ? new ConvexReactClient(url) : null

// Mode Convex (tranche 1) : auth + leads/users/rdv passent par Convex.
// Sans VITE_CONVEX_URL, tout reste sur l'API NestJS — comportement inchangé.
export const convexAuthEnabled = convexClient !== null
