import type { RealtimeRefreshPayload } from './realtime'

// Coalescing des refresh realtime (leading + trailing).
//
// Sans ça, chaque event WebSocket (lead:new, call-log:new, rdv:new…) déclenchait
// immédiatement un refetch de toutes les pages montées : sur un CRM actif où les
// setters loggent des appels en continu, l'app passait sa journée à recharger
// les mêmes listes et analytics. Ici :
//   - le PREMIER event part immédiatement (les chiffres restent réactifs) ;
//   - les events suivants dans la fenêtre sont fusionnés (union des paths) en
//     UN SEUL refresh émis à la fin de la fenêtre ;
//   - un flush trailing rouvre une fenêtre : au pire un refresh par fenêtre
//     tant que le flot d'events continue.
export function createRealtimeRefreshCoalescer(
  emit: (payload: RealtimeRefreshPayload) => void,
  cooldownMs: number,
): (payload: RealtimeRefreshPayload) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingPaths: Set<string> | null = null

  const flush = () => {
    timer = null
    if (!pendingPaths || pendingPaths.size === 0) return
    const paths = Array.from(pendingPaths)
    pendingPaths = null
    emit({ event: 'realtime:coalesced', paths })
    timer = setTimeout(flush, cooldownMs)
  }

  return (payload) => {
    if (timer === null) {
      emit(payload)
      timer = setTimeout(flush, cooldownMs)
      return
    }
    pendingPaths = pendingPaths ?? new Set()
    for (const path of payload.paths) pendingPaths.add(path)
  }
}

export const REALTIME_REFRESH_COOLDOWN_MS = 30_000
