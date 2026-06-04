import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers, useLeadDebriefs } from '../lib/hooks'
import { buildDossiers } from '../lib/suivi'
import { listProjectsByLead, getProjectDetail } from '../lib/api'
import { fullName, type ProjectDetailResponse } from '../lib/types'
import { FicheClientPanel } from '../components/suivi/FicheClientPanel'
import { ProjectDossierSection } from '../components/suivi/ProjectDossierSection'

/**
 * Page « Fiche complète » d'un client : la fiche (coordonnées + historique
 * global) à gauche, et tous les dossiers créés par les commerciaux regroupés
 * par projet (devis, photos, documents, débriefs) à droite.
 */
export function FicheCompletePage() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()

  const dossier = useMemo(() => {
    if (!id || !leads) return null
    return buildDossiers(leads ?? [], rdvs ?? [], users ?? [], {}).find((d) => d.id === id) ?? null
  }, [id, leads, rdvs, users])

  const { data: leadDebriefs } = useLeadDebriefs(dossier?.lead.id)

  const [details, setDetails] = useState<ProjectDetailResponse[] | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const leadId = dossier?.lead.id
  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    setLoadingProjects(true)
    setError(null)
    listProjectsByLead(leadId)
      .then(async (projects) => {
        const loaded = await Promise.all(projects.map((p) => getProjectDetail(p.id).catch(() => null)))
        if (cancelled) return
        setDetails(loaded.filter((d): d is ProjectDetailResponse => Boolean(d)))
      })
      .catch(() => {
        if (!cancelled) setError('Impossible de charger les projets du client.')
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const usersById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users ?? []) m.set(u.id, u.name)
    return m
  }, [users])

  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
    && role !== 'technicien'
  ) return <Navigate to="/overview" replace />
  if (!id) return <Navigate to="/suivi" replace />

  const isLoading = leadsLoading || rdvLoading

  return (
    <AppShell flat>
      <Topbar
        eyebrow="FICHE CLIENT"
        title={dossier ? (fullName(dossier.lead) || 'Client sans nom') : 'Fiche complète'}
      />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-breadcrumb">
          <Link to={`/suivi/${id}`}>← Retour au dossier</Link>
        </nav>

        {isLoading ? (
          <LoadingBlock label="Chargement de la fiche…" />
        ) : !dossier ? (
          <div className="suivi-empty">
            <p>Dossier introuvable.</p>
            <Link to="/suivi">Retour à la liste</Link>
          </div>
        ) : (
          <div className="suivi-split">
            <FicheClientPanel dossier={dossier} debriefs={leadDebriefs ?? []} />
            <div className="suivi-main-col">
              {error && (
                <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>
              )}
              {loadingProjects ? (
                <LoadingBlock label="Chargement des dossiers…" />
              ) : details && details.length > 0 ? (
                details.map((p) => (
                  <ProjectDossierSection key={p.id} project={p} commercialName={usersById.get(p.commercialId)} />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
                  Aucun projet pour ce client.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}
