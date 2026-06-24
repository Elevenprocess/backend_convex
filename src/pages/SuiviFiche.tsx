import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLead, useRdvList, useUsers, useLeadDebriefs } from '../lib/hooks'
import { buildDossier, readWorkflowState } from '../lib/suivi'
import { listProjectsByLead, getProjectDetail } from '../lib/api'
import { fullName, type ProjectDetailResponse } from '../lib/types'
import { FicheClientPanel } from '../components/suivi/FicheClientPanel'
import { ProjectDossierSection } from '../components/suivi/ProjectDossierSection'

/**
 * Page « Fiche complète » d'un client : la fiche (coordonnées + historique
 * global) à gauche, et tous les dossiers créés par les commerciaux regroupés
 * par projet (devis, photos, documents, débriefs) à droite. Un bouton ouvre le
 * workflow délivrabilité dans un panneau latéral, sans quitter la fiche.
 */
export function FicheCompletePage() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()
  // On charge directement le lead ciblé (et ses RDV) au lieu de ratisser des
  // centaines de leads pour en retrouver un : plus rapide, moins de payload, et
  // fiable même si le dossier n'était pas dans la première page de la liste.
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

  // Re-fetch d'un seul projet après un ajout (devis/photo/document/note) depuis
  // une carte, pour rafraîchir ses pièces sans recharger toute la fiche.
  const refreshProject = (projectId: string) => {
    void getProjectDetail(projectId)
      .then((fresh) => setDetails((prev) => (prev ? prev.map((p) => (p.id === fresh.id ? fresh : p)) : prev)))
      .catch(() => undefined)
  }

  const usersById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users ?? []) m.set(u.id, u.name)
    return m
  }, [users])

  // On n'affiche que les projets signés dans la fiche : les dossiers en
  // qualification / devis / perdu / abandonné ne sont pas pertinents ici.
  const signedProjects = useMemo(
    () => (details ?? []).filter((p) => p.status === 'signe'),
    [details],
  )

  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
    && role !== 'technicien'
    && role !== 'finances'
    && role !== 'commercial'
    && role !== 'commercial_lead'
  ) return <Navigate to="/overview" replace />
  if (!id) return <Navigate to="/suivi" replace />

  // Spinner plein écran uniquement au premier chargement : une fois le lead en
  // main, un refetch en arrière-plan (event realtime) ne doit pas refaire
  // clignoter « Chargement de la fiche… ».
  const isLoading = leadLoading && !lead

  return (
    <AppShell flat>
      <Topbar
        eyebrow="FICHE CLIENT"
        title={dossier ? (fullName(dossier.lead) || 'Client sans nom') : 'Fiche complète'}
      />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-breadcrumb">
          <Link to="/suivi">← Tous les dossiers</Link>
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
            <FicheClientPanel dossier={dossier} debriefs={leadDebriefs ?? []} onSaved={refetchLead} />
            <div className="suivi-main-col">
              <header className="fiche-projects-head">
                <div>
                  <span className="eyebrow text-or-dark">Dossiers commerciaux</span>
                  <h2>Projets & pièces du client</h2>
                  <p className="text-xs text-muted">Déployez un projet pour voir ses pièces, ou « Voir workflow » pour son suivi délivrabilité.</p>
                </div>
              </header>

              {error && (
                <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>
              )}
              {loadingProjects ? (
                <LoadingBlock label="Chargement des dossiers…" />
              ) : signedProjects.length > 0 ? (
                signedProjects.map((p) => (
                  <ProjectDossierSection
                    key={p.id}
                    project={p}
                    dossier={dossier}
                    commercialName={usersById.get(p.commercialId)}
                    onChanged={() => refreshProject(p.id)}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
                  Aucun projet signé pour ce client.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}
