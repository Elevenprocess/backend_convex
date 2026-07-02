import { describe, it, expect } from 'vitest'
import type { ClientPhaseStep, ClientResponse, WorkflowPhase } from './types'
import { isStepLate, buildDeliveryPipeline, selectDeliveryPriorities, selectRecentDeliveries } from './deliveryOverview'

const NOW = new Date('2026-06-09T12:00:00Z')

function step(partial: Partial<ClientPhaseStep>): ClientPhaseStep {
  return { status: 'a_faire', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null, ...partial }
}

describe('isStepLate', () => {
  it('true quand le statut est probleme', () => {
    expect(isStepLate(step({ status: 'probleme' }), NOW)).toBe(true)
  })
  it('true quand planifie avec date passée', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: '2026-06-01' }), NOW)).toBe(true)
  })
  it('false quand planifie avec date future', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: '2026-07-01' }), NOW)).toBe(false)
  })
  it('false quand planifie sans date', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: null }), NOW)).toBe(false)
  })
  it('false pour les autres statuts (a_faire, fait, en_cours)', () => {
    expect(isStepLate(step({ status: 'a_faire' }), NOW)).toBe(false)
    expect(isStepLate(step({ status: 'fait', datePlanifiee: '2026-06-01' }), NOW)).toBe(false)
    expect(isStepLate(step({ status: 'en_cours', datePlanifiee: '2026-06-01' }), NOW)).toBe(false)
  })
  it('false quand planifie avec une date impossible à parser', () => {
    expect(isStepLate(step({ status: 'planifie', datePlanifiee: 'pas-une-date' }), NOW)).toBe(false)
  })
})

function client(partial: Partial<ClientResponse> & { currentPhase: WorkflowPhase }): ClientResponse {
  return {
    id: 'c1', leadId: 'l1', rdvId: null,
    lead: { fullName: 'Test', city: 'Lyon', phone: null },
    technicienVtId: null, poseTeamLeadId: null, adminReferentId: null,
    statusGlobal: 'en_cours', blocked: false, missingDocsCount: 0,
    signedAt: '2026-06-05', steps: {}, ...partial,
  } as ClientResponse
}

describe('buildDeliveryPipeline', () => {
  it('tunnel cumulatif : un dossier compte dans chaque phase atteinte/franchie', () => {
    const clients = [client({ currentPhase: 'vt' }), client({ currentPhase: 'vt' }), client({ currentPhase: 'installation' })]
    const p = buildDeliveryPipeline(clients, NOW)
    expect(p.phases.vt.count).toBe(3) // 2 en vt + 1 (installation a franchi vt)
    expect(p.phases.dp.count).toBe(1) // seul le dossier installation
    expect(p.phases.installation.count).toBe(1)
    expect(p.phases.mes.count).toBe(0)
    expect(p.activeCount).toBe(3)
  })

  it('compte TOUS les dossiers, sans filtre par date de signature', () => {
    const clients = [
      client({ currentPhase: 'vt', signedAt: '2026-06-05' }),
      client({ currentPhase: 'vt', signedAt: '2020-01-01' }),
      client({ currentPhase: 'vt', signedAt: null }),
    ]
    const p = buildDeliveryPipeline(clients, NOW)
    expect(p.activeCount).toBe(3)
    expect(p.phases.vt.count).toBe(3)
  })

  it('exclut les dossiers annulés (VT non validée) et clôturés (livrés)', () => {
    const clients = [
      client({ currentPhase: 'vt', statusGlobal: 'en_cours' }),
      client({ currentPhase: 'vt', statusGlobal: 'annule' }),
      client({ currentPhase: 'mes', statusGlobal: 'cloture' }),
    ]
    const p = buildDeliveryPipeline(clients, NOW)
    expect(p.activeCount).toBe(1)
    expect(p.phases.vt.count).toBe(1)
    expect(p.phases.mes.count).toBe(0)
  })

  it('compte retards et docs manquants par phase courante et au global', () => {
    const clients = [
      client({ currentPhase: 'vt', steps: { vt: { status: 'probleme', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ currentPhase: 'consuel', missingDocsCount: 2 }),
    ]
    const p = buildDeliveryPipeline(clients, NOW)
    expect(p.phases.vt.late).toBe(1)
    expect(p.phases.consuel.missingDocs).toBe(1)
    expect(p.lateCount).toBe(1)
    expect(p.missingDocsCount).toBe(1)
  })

  it('compte les dossiers à livrer (installation/mes non livrés)', () => {
    const clients = [
      client({ currentPhase: 'installation' }),
      client({ currentPhase: 'mes', steps: { mes: { status: 'en_cours', datePlanifiee: null, dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ currentPhase: 'vt' }),
    ]
    const p = buildDeliveryPipeline(clients, NOW)
    expect(p.toDeliverCount).toBe(2)
  })
})

describe('selectDeliveryPriorities', () => {
  it('met les dossiers bloqués en tête, puis retard le plus ancien, puis docs manquants', () => {
    const clients = [
      client({ id: 'docs', currentPhase: 'consuel', missingDocsCount: 1 }),
      client({ id: 'late-old', currentPhase: 'racco', steps: { racco: { status: 'planifie', datePlanifiee: '2026-05-01', dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ id: 'blocked', currentPhase: 'vt', blocked: true }),
      client({ id: 'late-recent', currentPhase: 'vt', steps: { vt: { status: 'planifie', datePlanifiee: '2026-06-08', dateRealisee: null, problemReason: null, responsableId: null } } }),
      client({ id: 'clean', currentPhase: 'installation' }),
    ]
    const rows = selectDeliveryPriorities(clients, NOW)
    expect(rows.map((r) => r.client.id)).toEqual(['blocked', 'late-old', 'late-recent', 'docs'])
  })

  it('exclut les dossiers sans problème (ni bloqué, ni retard, ni docs manquants)', () => {
    const rows = selectDeliveryPriorities([client({ id: 'clean', currentPhase: 'mes' })], NOW)
    expect(rows).toHaveLength(0)
  })
})

describe('selectRecentDeliveries', () => {
  const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-12-31T23:59:59Z'), label: 'Année' }
  const mesStep = (dateRealisee: string | null) => ({ mes: { status: 'fait' as const, datePlanifiee: null, dateRealisee, problemReason: null, responsableId: null } })

  it('ne garde que les dossiers en mes avec dateRealisee dans la période, triés desc', () => {
    const clients = [
      client({ id: 'old', currentPhase: 'mes', steps: mesStep('2026-03-01') }),
      client({ id: 'recent', currentPhase: 'mes', steps: mesStep('2026-06-08') }),
      client({ id: 'out', currentPhase: 'mes', steps: mesStep('2020-01-01') }),
      client({ id: 'notmes', currentPhase: 'installation', steps: {} }),
      client({ id: 'nodate', currentPhase: 'mes', steps: mesStep(null) }),
    ]
    const res = selectRecentDeliveries(clients, range)
    expect(res.map((c) => c.id)).toEqual(['recent', 'old'])
  })
})

// ─── Arrivée filtrée depuis le funnel Overview (/suivi?phase=X) ───────────────

import { parseDeliveryPhase, clientMatchesPhase } from './deliveryOverview'

describe('parseDeliveryPhase', () => {
  it('accepte chacune des 6 phases du pipeline', () => {
    for (const p of ['vt', 'dp', 'racco', 'installation', 'consuel', 'mes']) {
      expect(parseDeliveryPhase(p)).toBe(p)
    }
  })
  it('rejette une valeur inconnue ou absente', () => {
    expect(parseDeliveryPhase('nimporte')).toBeNull()
    expect(parseDeliveryPhase('')).toBeNull()
    expect(parseDeliveryPhase(null)).toBeNull()
  })
})

describe('clientMatchesPhase', () => {
  it('true quand le dossier est actuellement à cette phase', () => {
    expect(clientMatchesPhase(client({ currentPhase: 'racco' }), 'racco')).toBe(true)
  })
  it('false pour une autre phase courante', () => {
    expect(clientMatchesPhase(client({ currentPhase: 'vt' }), 'racco')).toBe(false)
  })
  it('false pour un dossier annulé/clôturé (hors pipeline, comme le funnel Overview)', () => {
    expect(clientMatchesPhase(client({ currentPhase: 'mes', statusGlobal: 'cloture' }), 'mes')).toBe(false)
    expect(clientMatchesPhase(client({ currentPhase: 'vt', statusGlobal: 'annule' }), 'vt')).toBe(false)
  })
  it('false sans fiche client (dossier pas encore matérialisé côté délivrabilité)', () => {
    expect(clientMatchesPhase(undefined, 'vt')).toBe(false)
  })
})
