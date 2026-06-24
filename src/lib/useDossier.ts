import { useMemo } from 'react'
import { useLead, useRdvList, useUsers } from './hooks'
import { buildDossier, readWorkflowState, type Dossier } from './suivi'

/**
 * Construit le `Dossier` d'un client (lead + RDV signature + commercial/setter
 * résolus) à partir de son id. Partagé entre la Fiche complète et la page projet.
 */
export function useDossier(id: string | undefined): {
  dossier: Dossier | null
  leadLoading: boolean
  refetchLead: () => void
} {
  const { data: lead, loading: leadLoading, refetch: refetchLead } = useLead(id)
  const { data: rdvs } = useRdvList(id ? { leadId: id } : null)
  const { data: users } = useUsers()

  const dossier = useMemo(() => {
    if (!id || !lead) return null
    const userMap = new Map((users ?? []).map((u) => [u.id, u]))
    const rdv = [...(rdvs ?? [])].sort(
      (a, b) => new Date(b.signatureAt ?? b.scheduledAt ?? b.updatedAt).getTime()
        - new Date(a.signatureAt ?? a.scheduledAt ?? a.updatedAt).getTime(),
    )[0]
    const commercialId = rdv?.commercialId ?? lead.latestRdvCommercialId ?? lead.assignedToId
    const setterId = lead.setterId ?? lead.assignedSetterIds?.[0]
    return buildDossier(
      lead,
      rdv,
      commercialId ? userMap.get(commercialId) : undefined,
      setterId ? userMap.get(setterId) : undefined,
      readWorkflowState(lead.id),
    )
  }, [id, lead, rdvs, users])

  return { dossier, leadLoading, refetchLead }
}
