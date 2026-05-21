import { create } from 'zustand'

type NetworkActivityState = {
  inFlight: number
  start: () => void
  stop: () => void
  isLoading: () => boolean
}

// Compte les requêtes API en vol. Sert au loader principal de la Topbar :
// quand inFlight > 0 → animation, sinon → grille statique.
export const useNetworkActivity = create<NetworkActivityState>((set, get) => ({
  inFlight: 0,
  start: () => set((s) => ({ inFlight: s.inFlight + 1 })),
  stop: () => set((s) => ({ inFlight: Math.max(0, s.inFlight - 1) })),
  isLoading: () => get().inFlight > 0,
}))
