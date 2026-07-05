import { useEffect, useMemo } from 'react'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { leadsList, rdvList, usersList } from './convexApi'
import { mapConvexLead, mapConvexRdv, mapConvexUser } from './convexMappers'
import { useAuth } from './auth'
import type { LeadResponse, LeadStatus, RdvResponse, UserResponse } from './types'

// Adaptateurs Convex des hooks data de la tranche 1. Même contrat de retour
// que useFetch ({ data, loading, error, refetch }) pour que les pages ne
// voient pas la différence. refetch est un no-op : les useQuery Convex sont
// réactifs, la donnée arrive toute seule.

type Async<T> = { data: T | null; loading: boolean; error: string | null; refetch: () => void }
type AsyncProgressive<T> = Async<T> & { backgroundLoading: boolean }

const noop = () => {}
const PAGE_SIZE = 200

export function useConvexLeads(filters?: {
  status?: LeadStatus
  setterId?: string
  city?: string
  // acceptés pour compat de signature REST, sans effet côté Convex (tranche 1)
  assignedToId?: string
  search?: string
  limit?: number
  offset?: number
  quickLimit?: number
  fullLimit?: number
  notInAirtable?: boolean
  scope?: 'clients'
} | null): AsyncProgressive<LeadResponse[]> {
  const args = filters === null
    ? ('skip' as const)
    : { status: filters?.status, setterId: filters?.setterId, city: filters?.city }
  const { results, status, loadMore } = usePaginatedQuery(leadsList, args, { initialNumItems: PAGE_SIZE })

  // La page attend le tableau complet (liste virtualisée) : on déroule
  // automatiquement la pagination jusqu'à épuisement.
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(PAGE_SIZE)
  }, [status, loadMore])

  const data = useMemo(() => results.map(mapConvexLead), [results])
  return {
    data: filters === null ? null : data,
    loading: status === 'LoadingFirstPage' && filters !== null,
    backgroundLoading: status === 'LoadingMore' || status === 'CanLoadMore',
    error: null,
    refetch: noop,
  }
}

export function useConvexRdvList(filters?: {
  leadId?: string
  commercialId?: string
  setterId?: string
  fromDate?: string
  toDate?: string
  limit?: number
} | null): Async<RdvResponse[]> {
  const args = filters === null
    ? ('skip' as const)
    : {
        commercialId: filters?.commercialId,
        from: filters?.fromDate ? Date.parse(filters.fromDate) : undefined,
        to: filters?.toDate ? Date.parse(filters.toDate) : undefined,
      }
  const { results, status, loadMore } = usePaginatedQuery(rdvList, args, { initialNumItems: PAGE_SIZE })
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(PAGE_SIZE)
  }, [status, loadMore])

  // Filtre leadId non supporté par rdv:list — appliqué côté client.
  const leadId = filters === null ? undefined : filters?.leadId
  const data = useMemo(() => {
    const mapped = results.map(mapConvexRdv)
    return leadId ? mapped.filter((r) => r.leadId === leadId) : mapped
  }, [results, leadId])

  return {
    data: filters === null ? null : data,
    loading: status === 'LoadingFirstPage' && filters !== null,
    error: null,
    refetch: noop,
  }
}

const USERS_LIST_ROLES = new Set(['admin', 'setter_lead', 'commercial_lead'])

export function useConvexUsers(): Async<UserResponse[]> {
  // users:list exige un rôle lead/admin côté serveur — pour les autres rôles
  // on ne lance pas la requête (useQuery propagerait l'erreur au rendu) et on
  // renvoie une liste vide : les pages tolèrent l'absence de noms.
  const role = useAuth((s) => s.realUser?.role)
  const allowed = role !== undefined && role !== null && USERS_LIST_ROLES.has(role)
  const rows = useQuery(usersList, allowed ? {} : 'skip')
  const data = useMemo(() => {
    if (!allowed) return []
    if (rows === undefined) return null
    return rows.map(mapConvexUser)
  }, [allowed, rows])
  return { data, loading: allowed && rows === undefined, error: null, refetch: noop }
}
