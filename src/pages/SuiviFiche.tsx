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
 * par projet (devis, photos, documents, débriefs) à droite. Un bouton ouvre le
 * workflow délivrabilité dans un panneau latéral, sans quitter la fiche.
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
            <FicheClientPanel dossier={dossier} debriefs={leadDebriefs ?? []} />
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
