import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { LeadResponse, RdvResponse } from '../lib/types'

// Notifications.tsx importe le shell / les hooks au niveau module ; on les neutralise
// pour pouvoir importer la fonction pure buildCommercialNotifications.
vi.mock('../components/shell/AppShell', () => ({ AppShell: () => null }))
vi.mock('../components/shell/Topbar', () => ({ Topbar: () => null }))
vi.mock('../lib/hooks', () => ({ useLeads: () => ({ data: [] }), useNotifications: () => ({ data: [] }), useRdvList: () => ({ data: [] }) }))
vi.mock('../lib/api', () => ({ markNotificationRead: () => Promise.resolve() }))
vi.mock('../lib/realtime', () => ({ notifyRealtimeRefresh: () => {} }))
vi.mock('../lib/auth', () => ({ useAuth: () => undefined }))

import { buildCommercialNotifications } from './Notifications'

const NOW = '2026-06-15T12:00:00.000Z'

const lead = (over: Partial<LeadResponse>): LeadResponse => ({
  id: 'l', status: 'qualifie', firstName: 'Jean', lastName: 'Test', city: 'Saint-Denis',
  phone: '0692000000', lastStageChangeAt: '2026-06-15T10:00:00.000Z', updatedAt: NOW,
  ...over,
} as LeadResponse)

const rdv = (over: Partial<RdvResponse>): RdvResponse => ({
  id: 'r', leadId: 'l', status: 'planifie', result: null, scheduledAt: NOW,
  debriefFilledAt: null, lead: { id: 'l', firstName: 'Jean', lastName: 'Test', city: 'Saint-Denis', phone: '0692000000' },
  ...over,
} as RdvResponse)

const ids = (leads: LeadResponse[], rdvs: RdvResponse[]) => buildCommercialNotifications(leads, rdvs).map((n) => n.id)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)) })
afterEach(() => { vi.useRealTimers() })

describe('buildCommercialNotifications — 3 notifs commerciales', () => {
  it('notifie un nouveau lead qualifié récent', () => {
    expect(ids([lead({ id: 'l1', lastStageChangeAt: '2026-06-15T10:00:00.000Z' })], [])).toContain('commercial-lead-qualified-l1')
  })

  it('ignore un lead qualifié depuis plus de 48h', () => {
    expect(ids([lead({ id: 'l2', lastStageChangeAt: '2026-06-10T12:00:00.000Z' })], [])).toHaveLength(0)
  })

  it('ignore un lead non qualifié', () => {
    expect(ids([lead({ id: 'l3', status: 'nouveau' })], [])).toHaveLength(0)
  })

  it('notifie un RDV reporté dont la nouvelle date est dans <24h', () => {
    expect(ids([], [rdv({ id: 'r1', status: 'reporte', scheduledAt: '2026-06-15T14:00:00.000Z' })])).toContain('commercial-rdv-reporte-r1')
  })

  it('ignore un RDV reporté dont la date est au-delà de 24h', () => {
    expect(ids([], [rdv({ id: 'r2', status: 'reporte', scheduledAt: '2026-06-20T12:00:00.000Z' })])).toHaveLength(0)
  })

  it('notifie un débrief à faire (RDV honoré sans débrief)', () => {
    expect(ids([], [rdv({ id: 'r3', status: 'honore', debriefFilledAt: null, scheduledAt: '2026-06-14T12:00:00.000Z' })])).toContain('commercial-debrief-r3')
  })

  it('ignore un RDV honoré déjà débriefé', () => {
    expect(ids([], [rdv({ id: 'r4', status: 'honore', debriefFilledAt: '2026-06-14T13:00:00.000Z', scheduledAt: '2026-06-14T12:00:00.000Z' })])).toHaveLength(0)
  })

  it('alerte le commercial d\'une annulation signalée par l\'accueil', () => {
    const notifs = buildCommercialNotifications([], [rdv({
      id: 'a1', status: 'annule', receptionAlertKind: 'annule',
      receptionAlertAt: '2026-06-15T11:30:00.000Z', cancelReason: 'Empêchement',
    })])
    const card = notifs.find((n) => n.id === 'commercial-rdv-annule-a1')
    expect(card).toBeTruthy()
    expect(card?.urgency).toBe('now') // déclenche le push navigateur
  })

  it('alerte le commercial d\'un report signalé par l\'accueil (replanifié)', () => {
    expect(ids([], [rdv({
      id: 'a2', status: 'planifie', receptionAlertKind: 'reporte',
      receptionAlertAt: '2026-06-15T11:30:00.000Z', scheduledAt: '2026-06-18T09:00:00.000Z',
    })])).toContain('commercial-rdv-report-accueil-a2')
  })

  it('ignore un signalement réception de plus de 7 jours', () => {
    expect(ids([], [rdv({
      id: 'a3', status: 'annule', receptionAlertKind: 'annule',
      receptionAlertAt: '2026-06-01T11:30:00.000Z',
    })])).not.toContain('commercial-rdv-annule-a3')
  })
})
