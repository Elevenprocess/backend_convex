import { create } from 'zustand'
import type { CallResult } from './types'

export type CallState = {
  active: boolean
  minimized: boolean
  sidebarMinimized: boolean
  leadId: string | null
  leadName: string | null
  startedAt: number | null
  result: CallResult | ''
  notes: string
  startCall: (leadId: string, leadName: string) => void
  endCall: () => void
  minimize: () => void
  expand: () => void
  minimizeSidebar: () => void
  expandSidebar: () => void
  setResult: (result: CallResult | '') => void
  setNotes: (notes: string) => void
}

export const useCall = create<CallState>((set) => ({
  active: false,
  minimized: false,
  sidebarMinimized: false,
  leadId: null,
  leadName: null,
  startedAt: null,
  result: '',
  notes: '',
  startCall: (leadId, leadName) =>
    set({
      active: true,
      minimized: false,
      sidebarMinimized: false,
      leadId,
      leadName,
      startedAt: Date.now(),
      result: '',
      notes: '',
    }),
  endCall: () =>
    set({
      active: false,
      minimized: false,
      sidebarMinimized: false,
      leadId: null,
      leadName: null,
      startedAt: null,
      result: '',
      notes: '',
    }),
  minimize: () => set({ minimized: true }),
  expand: () => set({ minimized: false, sidebarMinimized: false }),
  minimizeSidebar: () => set({ sidebarMinimized: true }),
  expandSidebar: () => set({ sidebarMinimized: false }),
  setResult: (result) => set({ result }),
  setNotes: (notes) => set({ notes }),
}))
