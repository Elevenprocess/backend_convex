import type { ClientResponse } from './types'

export type TechEventType = 'vt' | 'installation'

export type TechCalendarEvent = {
  clientId: string
  leadId: string
  date: string // YYYY-MM-DD (datePlanifiee)
  type: TechEventType
  clientName: string
  city: string | null
  status: string
  // Technicien responsable de CETTE intervention : la VT est portée par
  // clients.technicienVtId, l'installation par le responsable de l'étape.
  technicienId: string | null
}

/** Dérive les interventions terrain (VT + installation planifiées) à afficher au planning. */
export function buildTechnicienEvents(clients: ClientResponse[]): TechCalendarEvent[] {
  const events: TechCalendarEvent[] = []
  for (const c of clients) {
    const name = c.lead.fullName ?? 'Client'
    const phases: TechEventType[] = ['vt', 'installation']
    for (const type of phases) {
      const step = c.steps[type]
      if (step?.datePlanifiee) {
        events.push({
          clientId: c.id,
          leadId: c.leadId,
          date: step.datePlanifiee,
          type,
          clientName: name,
          city: c.lead.city,
          status: step.status,
          technicienId: type === 'vt' ? c.technicienVtId : step.responsableId,
        })
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date))
}
