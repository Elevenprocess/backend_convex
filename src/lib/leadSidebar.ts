import { create } from 'zustand'

const STORAGE_KEY = 'ecoi.leads.selectedLeadId'

type LeadSidebarState = {
  selectedLeadId: string | null
  sidebarOpen: boolean
  selectLead: (leadId: string) => void
  closeSidebar: () => void
  clearLead: () => void
}

function readStoredLeadId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

const initialSelectedLeadId = readStoredLeadId()

export const useLeadSidebar = create<LeadSidebarState>((set) => ({
  selectedLeadId: initialSelectedLeadId,
  sidebarOpen: Boolean(initialSelectedLeadId),
  selectLead: (leadId) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, leadId)
    set({ selectedLeadId: leadId, sidebarOpen: true })
  },
  closeSidebar: () => {
    set({ sidebarOpen: false })
  },
  clearLead: () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
    set({ selectedLeadId: null, sidebarOpen: false })
  },
}))
