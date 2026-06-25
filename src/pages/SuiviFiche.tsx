import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLead, useRdvList, useUsers, useLeadDebriefs, useClients } from '../lib/hooks'
import { buildDossier, readWorkflowState } from '../lib/suivi'
import { listProjectsByLead, getProjectDetail } from '../lib/api'
import { fullName, type ClientResponse, type ProjectDetailResponse, type ProjectStatus } from '../lib/types'
import { FicheClientPanel } from '../components/suivi/FicheClientPanel'
import { ProjectCard } from '../components/suivi/ProjectCard'

// Ordre d'affichage des projets : actifs d'abord, perdus/abandonnés en dernier.
const STATUS_ORDER: Record<ProjectStatus, number> = {
  signe: 0, signature_en_cours: 1, devis_en_cours: 2, qualification: 3, perdu: 4, abandonne: 5,
}

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

  const usersById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users ?? []) m.set(u.id, u.name)
    return m
  }, [users])

  // Dossiers délivrabilité du lead → statut par projet. Un projet dont le
  // dossier est `annule` (VT non validée) est « non validé », même si le projet
  // lui-même reste `signe` côté commercial.
  const { data: clients } = useClients(leadId ? { leadId } : null)
  const cancelledProjectIds = useMemo(() => {
    const s = new Set<string>()
    for (const c of clients ?? []) {
      if (c.projectId && c.statusGlobal === 'annule') s.add(c.projectId)
    }
    return s
  }, [clients])

  // Dossier délivrabilité par projet → progression du workflow pour la jauge.
  const clientByProjectId = useMemo(() => {
    const m = new Map<string, ClientResponse>()
    for (const c of clients ?? []) if (c.projectId) m.set(c.projectId, c)
    return m
  }, [clients])

  // TOUS les projets du client (quel que soit le statut), triés actifs d'abord.
  // Le détail (workflow + pièces) s'ouvre dans la page projet dédiée au clic.
  const sortedProjects = useMemo(
    () => [...(details ?? [])].sort(
      (a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
        || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    ),
    [details],
  )
  const activeProjects = useMemo(
    () => sortedProjects.filter((p) => !cancelledProjectIds.has(p.id)),
    [sortedProjects, cancelledProjectIds],
  )
  const cancelledProjects = useMemo(
    () => sortedProjects.filter((p) => cancelledProjectIds.has(p.id)),
    [sortedProjects, cancelledProjectIds],
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
                  <h2>Projets du client</h2>
                  <p className="text-xs text-muted">Cliquez un projet pour ouvrir son workflow délivrabilité et ses dépôts de documents.</p>
                </div>
              </header>

              {error && (
                <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>
              )}
              {loadingProjects ? (
                <LoadingBlock label="Chargement des dossiers…" />
              ) : sortedProjects.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {activeProjects.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        client={clientByProjectId.get(p.id)}
                        commercialName={usersById.get(p.commercialId)}
                        to={`/suivi/${id}/projet/${p.id}`}
                      />
                    ))}
                    {activeProjects.length === 0 && (
                      <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
                        Aucun projet actif.
                      </div>
                    )}
                  </div>

                  {cancelledProjects.length > 0 && (
                    <section className="mt-7">
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-rouille">
                        Projets non validés (vente annulée) · {cancelledProjects.length}
                      </h3>
                      <div className="space-y-3">
                        {cancelledProjects.map((p) => (
                          <ProjectCard
                            key={p.id}
                            project={p}
                            client={clientByProjectId.get(p.id)}
                            commercialName={usersById.get(p.commercialId)}
                            to={`/suivi/${id}/projet/${p.id}`}
                            cancelled
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
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
