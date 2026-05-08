import { create } from 'zustand'

const STORAGE_KEY = 'ecoi.leads.selectedLeadId'

type LeadSidebarState = {
  selectedLeadId: string | null
  selectLead: (leadId: string) => void
  clearLead: () => void
}

function readStoredLeadId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

export const useLeadSidebar = create<LeadSidebarState>((set) => ({
  selectedLeadId: readStoredLeadId(),
  selectLead: (leadId) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, leadId)
    set({ selectedLeadId: leadId })
  },
  clearLead: () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
    set({ selectedLeadId: null })
  },
}))
