import { create } from 'zustand'

type NavSidebarState = {
  mobileOpen: boolean
  openMobile: () => void
  closeMobile: () => void
  toggleMobile: () => void
}

// Synchronise l'ouverture du drawer de navigation entre Topbar (bouton burger)
// et Sidebar (panneau lui-même). Concerne uniquement la fenêtre mobile —
// sur desktop la sidebar reste affichée en permanence et ce store est ignoré.
export const useNavSidebar = create<NavSidebarState>((set) => ({
  mobileOpen: false,
  openMobile: () => set({ mobileOpen: true }),
  closeMobile: () => set({ mobileOpen: false }),
  toggleMobile: () => set((s) => ({ mobileOpen: !s.mobileOpen })),
}))
