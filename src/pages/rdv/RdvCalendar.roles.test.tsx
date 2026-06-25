import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { VtCalendarEntry } from '../../lib/types'

vi.mock('../../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

const vt: VtCalendarEntry = {
  kind: 'vt', clientId: 'c-1', leadId: 'l-1', leadName: 'Jean Dupont', projectName: 'Projet Dupont', city: 'Saint-Denis',
  phone: '0600000000', date: '2026-06-08', status: 'planifie', technicienVtId: 't-1', technicienId: 't-1', techniciens: [], notes: null,
}

const ghlCalls: unknown[] = []
const vtCalls: unknown[] = []
let currentRole = 'technicien'

vi.mock('../../lib/hooks', () => ({
  useRdvList: () => ({ data: [], loading: false, error: null }),
  // Simule un 403 GHL (le technicien n'est pas autorisé sur /ghl-calendar/events) :
  // data absente + error renseignée, comme le ferait useFetch sur une 403.
  useGhlCalendarEvents: (filters?: unknown) => {
    ghlCalls.push(filters)
    return { data: undefined, loading: false, error: 'Forbidden' }
  },
  useLeads: () => ({ data: [], loading: false, error: null }),
  useUsers: () => ({ data: [], loading: false, error: null }),
  useVtCalendar: (filters?: unknown) => {
    vtCalls.push(filters)
    return { data: filters === null ? [] : [vt], loading: false, error: null }
  },
}))
vi.mock('../../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string } }) => unknown) => sel({ user: { role: currentRole } }),
}))

import { RdvCalendar } from './RdvCalendar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-08T06:00:00Z'))
  window.localStorage.clear()
  ghlCalls.length = 0
  vtCalls.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

const hasFromTo = (f: unknown) => !!(f as { from?: string } | null | undefined)?.from

describe('RdvCalendar — gating des feeds par rôle', () => {
  it('technicien : ne déclenche pas /ghl-calendar/events et affiche les VT malgré une erreur GHL', () => {
    currentRole = 'technicien'
    render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
    // L'erreur GHL (feed secondaire) ne doit PAS blanchir l'agenda : la VT reste visible.
    expect(screen.getAllByText(/VT — Jean Dupont/i).length).toBeGreaterThan(0)
    // GHL gated : aucun appel avec from/to (donc aucune requête réseau → pas de 403).
    expect(ghlCalls.every((f) => !hasFromTo(f))).toBe(true)
  })

  it('commercial : déclenche GHL et ne déclenche pas /clients/vt-calendar', () => {
    currentRole = 'commercial'
    render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
    expect(ghlCalls.some(hasFromTo)).toBe(true)
    expect(vtCalls.every((f) => f === null)).toBe(true)
  })
})

describe('RdvCalendar — filtre Commercial par rôle', () => {
  it('commercial : le filtre « Commercial » est masqué', () => {
    currentRole = 'commercial'
    render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
    expect(screen.queryByText('Commercial :')).toBeNull()
  })

  it('commercial_lead : le filtre « Commercial » est visible', () => {
    currentRole = 'commercial_lead'
    render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
    expect(screen.getByText('Commercial :')).toBeInTheDocument()
  })
})
