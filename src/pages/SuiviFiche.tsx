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
import { DossierWorkflowPanel } from '../components/suivi/DossierWorkflowPanel'

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
  const [workflowOpen, setWorkflowOpen] = useState(false)

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

  // Fermer le drawer workflow avec Échap.
  useEffect(() => {
    if (!workflowOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWorkflowOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workflowOpen])

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
                </div>
                <button type="button" className="fiche-wf-open-btn" onClick={() => setWorkflowOpen(true)}>
                  <span>Voir le workflow</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </header>

              {error && (
                <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>
              )}
              {loadingProjects ? (
                <LoadingBlock label="Chargement des dossiers…" />
              ) : signedProjects.length > 0 ? (
                signedProjects.map((p) => (
                  <ProjectDossierSection key={p.id} project={p} commercialName={usersById.get(p.commercialId)} />
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
                  Aucun projet signé pour ce client.
                </div>
              )}
            </div>
          </div>
        )}

        {dossier && workflowOpen && (
          <div className="fiche-wf-drawer-backdrop" onClick={() => setWorkflowOpen(false)}>
            <aside
              className="fiche-wf-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Workflow délivrabilité"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="fiche-wf-drawer-head">
                <div className="min-w-0">
                  <span className="eyebrow text-or-dark">Workflow délivrabilité</span>
                  <h2 className="truncate">{fullName(dossier.lead) || 'Client sans nom'}</h2>
                </div>
                <button
                  type="button"
                  className="fiche-wf-drawer-close"
                  onClick={() => setWorkflowOpen(false)}
                  aria-label="Fermer le workflow"
                >
                  ✕
                </button>
              </header>
              <div className="fiche-wf-drawer-body">
                <DossierWorkflowPanel dossier={dossier} />
              </div>
            </aside>
          </div>
        )}
      </main>
    </AppShell>
  )
}
