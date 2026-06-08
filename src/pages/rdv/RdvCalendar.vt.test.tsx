import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { VtCalendarEntry } from '../../lib/types'

vi.mock('../../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

const vt: VtCalendarEntry = {
  clientId: 'c-1', leadId: 'l-1', leadName: 'Jean Dupont', city: 'Saint-Denis',
  phone: '0600000000', date: '2026-06-08', status: 'planifie', technicienVtId: 't-1', notes: null,
}

vi.mock('../../lib/hooks', () => ({
  useRdvList: () => ({ data: [], loading: false, error: null }),
  useGhlCalendarEvents: () => ({ data: { events: [] }, loading: false, error: null }),
  useLeads: () => ({ data: [], loading: false, error: null }),
  useVtCalendar: () => ({ data: [vt], loading: false, error: null }),
}))
vi.mock('../../lib/auth', () => ({ useAuth: (sel: (s: { user?: { role: string } }) => unknown) => sel({ user: { role: 'technicien' } }) }))

import { RdvCalendar } from './RdvCalendar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-08T06:00:00Z'))
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RdvCalendar — VT', () => {
  it('affiche une carte VT dans le calendrier', () => {
    render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
    expect(screen.getAllByText(/VT — Jean Dupont/i).length).toBeGreaterThan(0)
  })
})
