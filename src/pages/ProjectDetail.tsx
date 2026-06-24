import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useDossier } from '../lib/useDossier'
import { getProjectDetail } from '../lib/api'
import { parseNotesJournal } from '../lib/notesJournal'
import { formatCurrency } from '../lib/suivi'
import { fullName, PROJECT_STATUS_LABEL, type DebriefResponse, type ProjectDetailResponse } from '../lib/types'
import { DossierWorkflowPanel } from '../components/suivi/DossierWorkflowPanel'
import { ProjectDossierSection, type ProjectTab } from '../components/suivi/ProjectDossierSection'
import { Section, Field, formatDebriefFinancingType, formatDebriefPaymentMethod } from '../components/suivi/fiche-parts'

type Tab = ProjectTab | 'paiement'

/**
 * Page dédiée d'UN projet : onglets (devis · documents · notes · mode de
 * paiement · débrief) façon Solteo à gauche, et le workflow délivrabilité en
 * sidebar repliable à droite. `/suivi/:id/projet/:projectId`.
 */
export function ProjectDetailPage() {
  const role = useAuth((s) => s.user?.role)
  const { id, projectId } = useParams<{ id: string; projectId: string }>()
  const { dossier, leadLoading } = useDossier(id)

  const [project, setProject] = useState<ProjectDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('devis')
  const [wfOpen, setWfOpen] = useState(true)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getProjectDetail(projectId)
      .then((p) => { if (!cancelled) setProject(p) })
      .catch(() => { if (!cancelled) setError('Projet introuvable ou inaccessible.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  const refresh = () => {
    if (!projectId) return
    void getProjectDetail(projectId).then((p) => setProject(p)).catch(() => undefined)
  }

  const counts = useMemo(() => {
    if (!project) return { devis: 0, documents: 0, notes: 0, debrief: 0 }
    return {
      devis: project.devis.length,
      documents: project.attachments.length,
      notes: parseNotesJournal(project.notes).length,
      debrief: project.debriefs.length,
    }
  }, [project])

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
  if (!id || !projectId) return <Navigate to="/suivi" replace />

  const ficheHref = `/suivi/${id}/fiche`

  const TABS: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'devis', label: 'Devis', count: counts.devis },
    { key: 'documents', label: 'Documents', count: counts.documents },
    { key: 'notes', label: 'Notes', count: counts.notes },
    { key: 'paiement', label: 'Mode de paiement' },
    { key: 'debrief', label: 'Débrief', count: counts.debrief },
  ]

  return (
    <AppShell flat>
      <Topbar eyebrow="PROJET" title={project?.name || 'Projet'} />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-breadcrumb">
          <Link to={ficheHref}>← {dossier ? (fullName(dossier.lead) || 'Fiche client') : 'Fiche client'}</Link>
        </nav>

        {(loading && !project) || (leadLoading && !dossier) ? (
          <LoadingBlock label="Chargement du projet…" />
        ) : error || !project || !dossier ? (
          <div className="suivi-empty">
            <p>{error ?? 'Projet introuvable.'}</p>
            <Link to={ficheHref}>Retour à la fiche</Link>
          </div>
        ) : (
          <>
            <header className="mb-4 flex flex-wrap items-baseline gap-2">
              <h1 className="text-xl font-semibold text-text">{project.name || 'Projet'}</h1>
              <span className="rounded-full bg-or-tint px-2 py-0.5 text-xs font-semibold text-or-dark">
                {PROJECT_STATUS_LABEL[project.status] ?? project.status}
              </span>
              {project.city && <span className="text-sm text-muted">· {project.city}</span>}
            </header>

            <div className="flex items-start gap-4">
              {/* Colonne onglets (façon Solteo) */}
              <div className="min-w-0 flex-1">
                <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                        tab === t.key ? 'border-cuivre text-text' : 'border-transparent text-muted hover:text-text'
                      }`}
                    >
                      {t.label}
                      {t.count != null && t.count > 0 && (
                        <span className="ml-1.5 rounded-full bg-or-tint px-1.5 py-0.5 text-[10px] font-semibold text-or-dark">{t.count}</span>
                      )}
                    </button>
                  ))}
                </div>

                {tab === 'paiement' ? (
                  <PaymentPanel project={project} />
                ) : (
                  <ProjectDossierSection project={project} dossier={dossier} pageMode activeTab={tab} onChanged={refresh} />
                )}
              </div>

              {/* Sidebar workflow repliable */}
              <aside className={`shrink-0 lg:sticky lg:top-4 ${wfOpen ? 'w-[min(440px,42vw)]' : 'w-11'}`}>
                <div className="rounded-2xl border border-line bg-card p-2">
                  <button
                    type="button"
                    onClick={() => setWfOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-sm font-semibold text-text hover:bg-cream"
                    title={wfOpen ? 'Réduire le workflow' : 'Développer le workflow'}
                  >
                    {wfOpen ? (
                      <>
                        <span className="eyebrow text-or-dark">Workflow délivrabilité</span>
                        <Icon name="chevron-right" size={18} className="text-muted" />
                      </>
                    ) : (
                      <span className="flex w-full flex-col items-center gap-1 py-1 text-muted">
                        <Icon name="settings" size={18} />
                        <span className="text-[10px] font-bold [writing-mode:vertical-rl]">WORKFLOW</span>
                      </span>
                    )}
                  </button>
                  {wfOpen && (
                    <div className="mt-2">
                      <DossierWorkflowPanel dossier={dossier} projectId={project.id} />
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
    </AppShell>
  )
}

/** Onglet « Mode de paiement » : financement/comptant dérivé du débrief de vente. */
function PaymentPanel({ project }: { project: ProjectDetailResponse }) {
  const debrief: DebriefResponse | null = [...project.debriefs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find((d) => d.financingType || d.paymentSubMethod || d.financingOrg || d.montantTotal) ?? null

  if (!debrief) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
        Aucune information de paiement (pas de débrief de vente sur ce projet).
      </div>
    )
  }

  const financing = formatDebriefFinancingType(debrief)
  const method = formatDebriefPaymentMethod(debrief)
  const acompte = debrief.acompteAmount
    ? `${Number(debrief.acompteAmount).toLocaleString('fr-FR')} €${debrief.acomptePercent != null ? ` (${debrief.acomptePercent} %)` : ''}`
    : (debrief.acomptePercent != null ? `${debrief.acomptePercent} %` : null)

  return (
    <Section title="Mode de paiement">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Montant total" value={debrief.montantTotal ? formatCurrency(Number(debrief.montantTotal)) : null} />
        <Field label="Type de financement" value={financing} />
        <Field label="Méthode" value={method} />
        <Field label="Organisme" value={debrief.financingOrg} />
        <Field label="Acompte" value={acompte} wide />
        {debrief.kits && <Field label="Kit installé" value={debrief.kits} wide />}
      </dl>
    </Section>
  )
}
