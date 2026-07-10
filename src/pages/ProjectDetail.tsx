import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useDossier } from '../lib/useDossier'
import { useClients } from '../lib/hooks'
import { getProjectDetail, updateFinancing, getAcompte } from '../lib/api'
import { parseNotesJournal } from '../lib/notesJournal'
import { canEditPayment } from '../lib/role'
import { formatDate } from '../lib/suivi'
import { fullName, PROJECT_STATUS_LABEL, type ProjectDetailResponse, type AcompteResponse, type EcheanceLine } from '../lib/types'
import { DossierWorkflowPanel } from '../components/suivi/DossierWorkflowPanel'
import { ProjectDossierSection, type ProjectTab } from '../components/suivi/ProjectDossierSection'
import { Section } from '../components/suivi/fiche-parts'
import { RecordEcheanceModal } from '../components/finances/RecordEcheanceModal'
import { EcheancierEditorModal } from '../components/finances/EcheancierEditorModal'

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
  // Mobile : le workflow s'ouvre en plein écran (la sidebar 42vw l'écrasait).
  const [wfMobileOpen, setWfMobileOpen] = useState(false)
  // Acompte chargé au niveau page pour le bandeau dossier.
  const [pageAcompte, setPageAcompte] = useState<AcompteResponse | null>(null)

  // Dossier délivrabilité du projet : `annule` = VT non validée → vente annulée.
  const { data: projectClients } = useClients(projectId ? { projectId } : null)
  const cancelled = (projectClients ?? []).some((c) => c.statusGlobal === 'annule')

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

  // Fetch the acompte at the page level so we can show the banner above the tabs.
  useEffect(() => {
    if (!project) return
    const debrief = [...project.debriefs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .find((d) => d.financingType || d.paymentSubMethod || d.financingOrg || d.montantTotal) ?? null
    if (!debrief) { setPageAcompte(null); return }
    let cancelled = false
    getAcompte(debrief.id)
      .then((a) => { if (!cancelled) setPageAcompte(a) })
      .catch(() => { if (!cancelled) setPageAcompte(null) })
    return () => { cancelled = true }
  }, [project])

  const refresh = () => {
    if (!projectId) return
    void getProjectDetail(projectId).then((p) => setProject(p)).catch(() => undefined)
  }

  useEffect(() => {
    if (!wfMobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWfMobileOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wfMobileOpen])

  const counts = useMemo(() => {
    if (!project) return { devis: 0, documents: 0, notes: 0, debrief: 0 }
    return {
      devis: project.devis.length,
      documents: project.attachments.length,
      notes: parseNotesJournal(project.notes).length,
      debrief: project.debriefs.length,
    }
  }, [project])

  if (role === 'technicien') return <Navigate to="/mes-dossiers" replace />
  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
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
              <h1 className={`text-xl font-semibold ${cancelled ? 'text-muted line-through' : 'text-text'}`}>{project.name || 'Projet'}</h1>
              {cancelled ? (
                <span className="rounded-full bg-rouille-tint px-2 py-0.5 text-xs font-semibold text-rouille">VT non validée · vente annulée</span>
              ) : (
                <span className="rounded-full bg-or-tint px-2 py-0.5 text-xs font-semibold text-or-dark">
                  {PROJECT_STATUS_LABEL[project.status] ?? project.status}
                </span>
              )}
              {(() => {
                const addr = [project.addressLine, [project.postalCode, project.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
                return addr ? <span className="text-sm text-muted">· {addr}</span> : null
              })()}
            </header>

            {/* Mobile : ouvre le workflow en plein écran (la sidebar est masquée < lg) */}
            <button
              type="button"
              onClick={() => setWfMobileOpen(true)}
              className="mb-4 flex w-full items-center justify-between gap-2 rounded-2xl border border-line bg-card px-4 py-3 text-sm font-semibold text-text lg:hidden"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-or-tint text-or-dark"><Icon name="settings" size={16} /></span>
                Workflow délivrabilité
              </span>
              <Icon name="chevron-right" size={18} className="text-muted" />
            </button>

            {/* Bandeau acompte à encaisser / en retard — visible sur tous les onglets */}
            {pageAcompte && (() => {
              const urgent = pageAcompte.echeances.filter((e) => e.statut === 'a_encaisser' || e.statut === 'en_retard')
              if (urgent.length === 0) return null
              const montantUrgent = urgent.reduce((s, e) => s + (Number(e.montantPrevu ?? 0) || 0), 0)
              const enRetard = urgent.some((e) => e.statut === 'en_retard')
              return (
                <div
                  className={`mb-4 flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3 ${enRetard ? 'bg-rouille-tint' : 'bg-cuivre-tint'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setTab('paiement')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTab('paiement') }}
                  title="Voir le détail des paiements"
                >
                  <span className={`mt-0.5 text-sm font-black ${enRetard ? 'text-rouille' : 'text-cuivre'}`}>
                    {enRetard ? '⚠' : '⏰'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold ${enRetard ? 'text-rouille' : 'text-cuivre'}`}>
                      Acompte à encaisser{enRetard ? ' (en retard)' : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {urgent.map((e) => e.label ?? `Tranche ${e.ordre}`).join(', ')}
                      {' — '}{montantUrgent.toLocaleString('fr-FR')} € à récupérer · Voir l'onglet Paiement
                    </p>
                  </div>
                </div>
              )
            })()}

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
                  <PaymentTab project={project} onSaved={refresh} />
                ) : (
                  <ProjectDossierSection project={project} dossier={dossier} pageMode activeTab={tab} onChanged={refresh} />
                )}
              </div>

              {/* Sidebar workflow repliable — desktop uniquement (sur mobile : plein écran) */}
              <aside className={`hidden shrink-0 lg:sticky lg:top-4 lg:block ${wfOpen ? 'lg:w-[min(440px,42vw)]' : 'lg:w-11'}`}>
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

            {/* Workflow en plein écran sur mobile */}
            {wfMobileOpen && (
              <div
                className="fixed inset-0 z-[210] flex items-stretch justify-center bg-[rgba(12, 27, 36,0.58)] backdrop-blur-sm lg:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Workflow délivrabilité"
                onClick={() => setWfMobileOpen(false)}
              >
                <div
                  className="flex h-full w-full flex-col overflow-hidden bg-cream-darker"
                  onClick={(e) => e.stopPropagation()}
                  style={{ animation: 'fiche-wf-fade .16s ease' }}
                >
                  <header className="flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-or-tint text-or-dark">
                        <Icon name="settings" size={16} />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-black leading-tight text-text">Workflow délivrabilité</h2>
                        <p className="truncate text-[11px] leading-tight text-muted">{project.name || 'Projet'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWfMobileOpen(false)}
                      aria-label="Fermer"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-muted transition hover:border-rouille/40 hover:bg-rouille-tint hover:text-rouille"
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </header>
                  <div
                    className="min-h-0 flex-1 overflow-auto p-4"
                    style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
                  >
                    <DossierWorkflowPanel dossier={dossier} projectId={project.id} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}

const FINANCING_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'financement', label: 'Financement' },
  { value: 'comptant', label: 'Au comptant' },
  { value: 'paiement_10x', label: 'Paiement x10' },
  { value: 'paiement_12x', label: 'Paiement x12' },
]

const ORG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'cmoi', label: 'CMOI' },
  { value: 'sofider', label: 'Sofider' },
]

const money = (v: string | number | null | undefined): string => {
  const n = Number(v ?? 0)
  return Number.isNaN(n) ? '—' : `${n.toLocaleString('fr-FR')} €`
}

/**
 * Onglet « Mode de paiement », lié à l'échéancier Finances (acompte_echeances).
 * Comportement par TYPE :
 *  - comptant : pas d'organisme. Liste de paiements libres, total/reste à payer,
 *    ajout de paiement + recalcul.
 *  - financement : organisme (CMOI/Sofider) + acompte comptant + solde financé.
 *  - x10 / x12 : 10/12 échéances générées, on coche celles payées.
 * Éditable par admin / responsable_technique / back_office.
 */
function PaymentTab({ project, onSaved }: { project: ProjectDetailResponse; onSaved: () => void }) {
  const role = useAuth((s) => s.user?.role)
  const canEdit = canEditPayment(role)

  const debrief = useMemo(() => [...project.debriefs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find((d) => d.financingType || d.paymentSubMethod || d.financingOrg || d.montantTotal) ?? null, [project.debriefs])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState(false)
  const [loaded, setLoaded] = useState<AcompteResponse | null>(null)
  const [financingType, setFinancingType] = useState('')
  const [montantTotal, setMontantTotal] = useState('')
  const [financingOrg, setFinancingOrg] = useState('')
  // Recording encaissement for a specific tranche
  const [recordingTranche, setRecordingTranche] = useState<EcheanceLine | null>(null)
  // Editing the échéancier (custom tranche definition)
  const [editingEcheancier, setEditingEcheancier] = useState(false)

  const hydrate = (a: AcompteResponse) => {
    setLoaded(a)
    setFinancingType(a.financingType ?? '')
    setMontantTotal(a.montantTotal ?? '')
    setFinancingOrg(a.financingOrg ?? '')
  }

  useEffect(() => {
    if (!debrief) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    getAcompte(debrief.id)
      .then((a) => { if (!cancelled) hydrate(a) })
      .catch(() => { if (!cancelled) setError('Impossible de charger le suivi de paiement.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debrief?.id])

  if (!debrief) {
    return (
      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
        Aucune information de paiement (pas de débrief de vente sur ce projet).
      </div>
    )
  }
  if (loading) return <LoadingBlock label="Chargement du paiement…" />

  const a = loaded
  const total = Number(montantTotal) || 0
  const isFinancement = financingType === 'financement' || financingType === 'financement_sans_apport' || financingType === 'apport_financement'

  const totalEncaisse = a ? Number(a.totalEncaisse ?? 0) || 0 : 0
  const resteAPayer = a ? Number(a.resteAPayer ?? 0) || 0 : 0
  const pct = total > 0 ? Math.min(100, Math.round((totalEncaisse / total) * 100)) : 0
  const nbEncaisse = a ? a.echeances.filter((e) => e.statut === 'encaisse').length : 0

  const save = async () => {
    if (!a) return
    setSaving(true)
    setError(null)
    try {
      await updateFinancing(debrief.id, {
        financingType: financingType || null,
        montantTotal: montantTotal.trim() || null,
        financingOrg: isFinancement ? (financingOrg || null) : null,
      })
      const fresh = await getAcompte(debrief.id)
      hydrate(fresh)
      onSaved()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    if (loaded) hydrate(loaded)
    setError(null)
    setEditing(false)
  }

  const typeLabel = FINANCING_TYPE_OPTIONS.find((o) => o.value === financingType)?.label ?? (financingType || '—')
  const orgLabel = ORG_OPTIONS.find((o) => o.value === financingOrg)?.label ?? (financingOrg || '—')

  return (
    <Section
      title="Mode de paiement"
      action={canEdit ? (
        editing ? (
          <div className="flex items-center gap-3">
            <button type="button" className="text-xs font-bold text-or hover:underline disabled:opacity-50" onClick={() => void save()} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button type="button" className="text-xs font-medium text-muted hover:underline disabled:opacity-50" onClick={cancel} disabled={saving}>
              Annuler
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold text-or hover:underline" onClick={() => setEditing(true)}>
              <Icon name="edit" size={14} /> Modifier
            </button>
            {a && (
              <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-text hover:underline" onClick={() => setEditingEcheancier(true)} title="Personnaliser l'échéancier">
                <Icon name="settings" size={13} /> Échéancier{a.customEcheancier ? ' *' : ''}
              </button>
            )}
          </div>
        )
      ) : undefined}
    >
      {editing ? (
        <div className="space-y-4">
          {/* Champs en cartes / inputs — uniquement en mode modification */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PayField label="Type de paiement">
              <select className="wf-modal-input w-full" value={financingType} onChange={(e) => setFinancingType(e.target.value)}>
                <option value="">— Non renseigné —</option>
                {FINANCING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </PayField>
            <PayField label="Montant total (€)">
              <input className="wf-modal-input w-full" inputMode="decimal" value={montantTotal} onChange={(e) => setMontantTotal(e.target.value)} placeholder="ex : 12000" />
            </PayField>
            {isFinancement && (
              <PayField label="Organisme de financement">
                <select className="wf-modal-input w-full" value={financingOrg} onChange={(e) => setFinancingOrg(e.target.value)}>
                  <option value="">— Choisir —</option>
                  {ORG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </PayField>
            )}
          </div>
        </div>
      ) : (
        <div className="pay-view">
          {/* Bandeau acompte à encaisser / en retard */}
          {a && (() => {
            const urgent = a.echeances.filter((e) => e.statut === 'a_encaisser' || e.statut === 'en_retard')
            if (urgent.length === 0) return null
            const montantTotal = urgent.reduce((s, e) => s + (Number(e.montantPrevu ?? 0) || 0), 0)
            const enRetard = urgent.some((e) => e.statut === 'en_retard')
            return (
              <div className={`mb-4 flex items-start gap-3 rounded-xl px-4 py-3 ${enRetard ? 'bg-rouille-tint' : 'bg-cuivre-tint'}`}>
                <span className={`mt-0.5 text-sm font-black ${enRetard ? 'text-rouille' : 'text-cuivre'}`}>
                  {enRetard ? '⚠' : '⏰'}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${enRetard ? 'text-rouille' : 'text-cuivre'}`}>
                    Acompte à encaisser{enRetard ? ' (en retard)' : ''}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {urgent.map((e) => e.label ?? `Tranche ${e.ordre}`).join(', ')}
                    {' — '}{montantTotal.toLocaleString('fr-FR')} € à récupérer
                  </p>
                </div>
              </div>
            )
          })()}
          {/* Hero : reste à payer + progression — données backend */}
          <div className="pay-hero">
            <div className="pay-hero-figures">
              <div className="pay-hero-main">
                <span className="pay-hero-label">Reste à payer</span>
                <strong className={`pay-hero-amount ${resteAPayer > 0 ? 'is-due' : 'is-clear'}`}>{money(a?.resteAPayer ?? null)}</strong>
              </div>
              <div className="pay-hero-side">
                <span>Encaissé<b>{money(a?.totalEncaisse ?? null)}</b></span>
                <span>Total<b>{money(a?.montantTotal ?? null)}</b></span>
              </div>
            </div>
            <div className="pay-progress"><div className="pay-progress-fill" style={{ width: `${pct}%` }} /></div>
            <div className="pay-progress-meta">
              <span>{pct}% encaissé</span>
              <span>{nbEncaisse}/{a?.echeances.length ?? 0} tranche{(a?.echeances.length ?? 0) > 1 ? 's' : ''} encaissée{(a?.echeances.length ?? 0) > 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Type / organisme — flat, sans carte */}
          <div className="pay-attrs">
            <div className="pay-attr"><span>Type de paiement</span><strong>{typeLabel}</strong></div>
            {isFinancement && <div className="pay-attr"><span>Organisme</span><strong>{orgLabel}</strong></div>}
          </div>

          {/* Échéancier — avec statut pills et boutons d'enregistrement */}
          <EcheancesTable
            acompte={a}
            canEdit={canEdit}
            onRecord={(tranche) => setRecordingTranche(tranche)}
          />
        </div>
      )}

      {error && <p className="wf-modal-error mt-3">{error}</p>}

      {recordingTranche && a && (
        <RecordEcheanceModal
          acompte={a}
          tranche={recordingTranche}
          onClose={() => setRecordingTranche(null)}
          onSaved={() => {
            setRecordingTranche(null)
            // Refresh acompte data
            getAcompte(debrief.id).then(hydrate).catch(() => undefined)
            onSaved()
          }}
        />
      )}

      {editingEcheancier && a && (
        <EcheancierEditorModal
          acompte={a}
          onClose={() => setEditingEcheancier(false)}
          onSaved={() => {
            setEditingEcheancier(false)
            getAcompte(debrief.id).then(hydrate).catch(() => undefined)
            onSaved()
          }}
        />
      )}
    </Section>
  )
}

function PayField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  )
}

const STATUT_META_PD: Record<string, { label: string; cls: string }> = {
  en_attente: { label: 'En attente', cls: 'bg-line text-faint' },
  a_encaisser: { label: 'À encaisser', cls: 'bg-cuivre-tint text-cuivre' },
  encaisse: { label: 'Encaissé', cls: 'bg-or-tint text-or-dark' },
  en_retard: { label: 'En retard', cls: 'bg-rouille-tint text-rouille' },
  annule: { label: 'Annulé', cls: 'bg-line text-faint' },
}

/**
 * Affiche l'échéancier complet d'une vente : libellé, jalon, montant prévu,
 * statut pill, dates. Bouton « Enregistrer » par tranche (déclenche RecordEcheanceModal).
 */
function EcheancesTable({
  acompte: a,
  canEdit,
  onRecord,
}: {
  acompte: AcompteResponse | null
  canEdit: boolean
  onRecord: (tranche: EcheanceLine) => void
}) {
  if (!a) return null
  if (a.echeances.length === 0) {
    return <p className="pay-empty mt-3">Aucune tranche dans l'échéancier.</p>
  }
  return (
    <div className="pay-schedule mt-3">
      <div className="pay-schedule-head">Échéancier</div>
      {a.echeances.map((e) => {
        const meta = STATUT_META_PD[e.statut] ?? { label: e.statut, cls: 'bg-line text-faint' }
        const montantAffiche = e.statut === 'encaisse' ? (e.montantReel ?? e.montantPrevu) : e.montantPrevu
        return (
          <div key={e.ordre} className={`pay-row ${e.statut === 'encaisse' ? 'is-paid' : ''}`}>
            <span className="pay-check" aria-hidden><Icon name="check" size={13} /></span>
            <span className="pay-row-label flex-1">
              <span className="font-semibold">{e.label ?? `Tranche ${e.ordre}`}</span>
              {e.percent != null && <span className="text-faint text-xs ml-1">({e.percent}%)</span>}
            </span>
            <span className="shrink-0">
              <span className={`fin-pill text-xs ${meta.cls}`}>{meta.label}</span>
            </span>
            {e.jalonKey && (
              <span className="text-xs shrink-0">
                {e.jalonAtteint
                  ? <span className="text-or-dark font-semibold">✓</span>
                  : <span className="text-faint">jalon ⏳</span>}
              </span>
            )}
            {e.dateEncaissement
              ? <span className="pay-row-date">{formatDate(e.dateEncaissement)}</span>
              : e.dateEcheance && <span className="pay-row-date text-faint">éch. {formatDate(e.dateEcheance)}</span>}
            <span className="pay-row-amount">{money(montantAffiche)}</span>
            {canEdit && (
              <button type="button" className="fin-action ml-1 shrink-0" onClick={() => onRecord(e)}>
                {e.statut === 'encaisse' ? 'Modifier' : 'Enregistrer'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
