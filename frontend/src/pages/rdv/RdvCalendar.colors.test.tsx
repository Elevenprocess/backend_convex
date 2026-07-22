import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RdvResponse } from '../../lib/types'

vi.mock('../../components/shell/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/shell/Topbar', () => ({ Topbar: () => null }))

let currentRole = 'admin'

const baseRdv = (over: Partial<RdvResponse>): RdvResponse => ({
  id: 'r1', externalId: null, leadId: 'lead-1', commercialId: 'c-1',
  scheduledAt: '2026-06-10T06:00:00.000Z', locationType: 'domicile',
  status: 'honore', result: null, signatureAt: null, montantTotal: null,
  financingType: null, objections: null, nonSaleReason: null, kits: null,
  notes: null, debriefFilledAt: '2026-06-10T07:00:00.000Z', debriefDueAt: null, debriefNotifiedAt: null, debriefOpenedAt: null,
  hasDevisEnAttente: false, cancelReason: null, receptionAlertAt: null, receptionAlertKind: null,
  createdAt: '2026-06-10T05:00:00.000Z',
  updatedAt: '2026-06-10T05:00:00.000Z', lead: null,
  ...over,
})

vi.mock('../../lib/hooks', () => ({
  useRdvList: () => ({ data: [baseRdv({})], loading: false, error: null }),
  useGhlCalendarEvents: () => ({ data: undefined, loading: false, error: null }),
  useLeads: () => ({ data: [], loading: false, error: null }),
  useUsers: () => ({ data: [], loading: false, error: null }),
  useVtCalendar: () => ({ data: [], loading: false, error: null }),
}))
vi.mock('../../lib/auth', () => ({
  useAuth: (sel: (s: { user?: { role: string } }) => unknown) => sel({ user: { role: currentRole } }),
}))

import { RdvCalendar } from './RdvCalendar'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-10T08:00:00.000Z'))
  window.localStorage.clear()
})
afterEach(() => vi.useRealTimers())

function renderMonth() {
  const result = render(<MemoryRouter><RdvCalendar /></MemoryRouter>)
  fireEvent.click(result.getByText('Mois'))
  return result
}

describe('RdvCalendar — coloration des cartes', () => {
  it('admin : un RDV local débriefé est colorié en vert (bg-success-tint)', () => {
    currentRole = 'admin'
    const { container } = renderMonth()
    const card = container.querySelector('.rdv-block')
    expect(card).not.toBeNull()
    expect(card!.className).toContain('bg-success-tint')
  })

  it('setter : pas de coloration, fond neutre (bg-cream-darker)', () => {
    currentRole = 'setter'
    const { container } = renderMonth()
    const card = container.querySelector('.rdv-block')
    expect(card).not.toBeNull()
    expect(card!.className).toContain('bg-cream-darker')
    expect(card!.className).not.toContain('bg-success-tint')
  })
})
