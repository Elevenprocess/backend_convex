import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useDossier } from '../lib/useDossier'
import { useClients } from '../lib/hooks'
import { getProjectDetail, updateFinancing, getAcompte, setEcheancier } from '../lib/api'
import { parseNotesJournal } from '../lib/notesJournal'
import { todayIso } from '../lib/suivi-board'
import { fullName, PROJECT_STATUS_LABEL, type ProjectDetailResponse, type AcompteResponse, type EcheancierTranchePatch } from '../lib/types'
import { DossierWorkflowPanel } from '../components/suivi/DossierWorkflowPanel'
import { ProjectDossierSection, type ProjectTab } from '../components/suivi/ProjectDossierSection'
import { Section } from '../components/suivi/fiche-parts'

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
              <h1 className={`text-xl font-semibold ${cancelled ? 'text-muted line-through' : 'text-text'}`}>{project.name || 'Projet'}</h1>
              {cancelled ? (
                <span className="rounded-full bg-rouille-tint px-2 py-0.5 text-xs font-semibold text-rouille">VT non validée · vente annulée</span>
              ) : (
                <span className="rounded-full bg-or-tint px-2 py-0.5 text-xs font-semibold text-or-dark">
                  {PROJECT_STATUS_LABEL[project.status] ?? project.status}
                </span>
              )}
              {project.city && <span className="text-sm text-muted">· {project.city}</span>}
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
                className="fixed inset-0 z-[210] flex items-stretch justify-center bg-[rgba(15,30,22,0.58)] backdrop-blur-sm lg:hidden"
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

type PayLine = { label: string; montant: string; paid: boolean; date: string }

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
  const canEdit = role === 'admin' || role === 'responsable_technique' || role === 'back_office'

  const debrief = useMemo(() => [...project.debriefs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find((d) => d.financingType || d.paymentSubMethod || d.financingOrg || d.montantTotal) ?? null, [project.debriefs])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [financingType, setFinancingType] = useState('')
  const [montantTotal, setMontantTotal] = useState('')
  const [financingOrg, setFinancingOrg] = useState('')
  const [lines, setLines] = useState<PayLine[]>([])

  const hydrate = (a: AcompteResponse) => {
    setFinancingType(a.financingType ?? '')
    setMontantTotal(a.montantTotal ?? '')
    setFinancingOrg(a.financingOrg ?? '')
    setLines(a.echeances.map((e) => ({
      label: e.label ?? (e.percent != null ? `${e.percent}%` : 'Paiement'),
      montant: e.montantReel ?? e.montantPrevu ?? '',
      paid: e.statut === 'encaisse',
      date: e.dateEncaissement ?? e.dateEcheance ?? '',
    })))
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

  const total = Number(montantTotal) || 0
  const paidSum = lines.filter((l) => l.paid).reduce((s, l) => s + (Number(l.montant) || 0), 0)
  const reste = total - paidSum
  const isFinancement = financingType === 'financement' || financingType === 'financement_sans_apport' || financingType === 'apport_financement'
  const isEchelonne = financingType === 'paiement_10x' || financingType === 'paiement_12x'
  const nbEcheances = financingType === 'paiement_10x' ? 10 : financingType === 'paiement_12x' ? 12 : 0

  const setLine = (i: number, patch: Partial<PayLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines((ls) => [...ls, { label: `Paiement ${ls.length + 1}`, montant: '', paid: false, date: '' }])
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i))
  const generateEcheances = (n: number) => {
    const each = total ? (total / n).toFixed(2) : ''
    setLines(Array.from({ length: n }, (_, i) => ({ label: `Échéance ${i + 1}/${n}`, montant: each, paid: false, date: '' })))
  }
  const initFinancement = () => setLines([
    { label: 'Acompte (comptant)', montant: '', paid: false, date: '' },
    { label: 'Solde financé', montant: montantTotal, paid: false, date: '' },
  ])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateFinancing(debrief.id, {
        financingType: financingType || null,
        montantTotal: montantTotal.trim() || null,
        financingOrg: isFinancement ? (financingOrg || null) : null,
      })
      const src = lines.length ? lines : [{ label: 'À définir', montant: montantTotal, paid: false, date: '' }]
      const tranches: EcheancierTranchePatch[] = src.map((l) => ({
        label: l.label || null,
        percent: null,
        montantPrevu: l.montant.trim() || null,
        jalonKey: null,
        statut: l.paid ? 'encaisse' : 'a_encaisser',
        montantReel: l.paid ? (l.montant.trim() || null) : null,
        dateEncaissement: l.paid ? (l.date || null) : null,
        dateEcheance: !l.paid ? (l.date || null) : null,
      }))
      await setEcheancier(debrief.id, tranches)
      const fresh = await getAcompte(debrief.id)
      hydrate(fresh)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Mode de paiement"
      action={canEdit ? (
        <button type="button" className="text-xs font-semibold text-or hover:underline disabled:opacity-50" onClick={() => void save()} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      ) : undefined}
    >
      {/* En-tête : type + montant + organisme (financement) */}
      <div className="grid grid-cols-2 gap-3">
        <PayField label="Type de paiement">
          {canEdit ? (
            <select className="wf-modal-input w-full" value={financingType} onChange={(e) => setFinancingType(e.target.value)}>
              <option value="">— Non renseigné —</option>
              {FINANCING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <div className="text-sm font-semibold text-text">{FINANCING_TYPE_OPTIONS.find((o) => o.value === financingType)?.label ?? financingType ?? '—'}</div>
          )}
        </PayField>
        <PayField label="Montant total (€)">
          {canEdit ? (
            <input className="wf-modal-input w-full" inputMode="decimal" value={montantTotal} onChange={(e) => setMontantTotal(e.target.value)} placeholder="ex : 12000" />
          ) : (
            <div className="text-sm font-semibold text-text">{money(montantTotal)}</div>
          )}
        </PayField>
        {isFinancement && (
          <PayField label="Organisme de financement">
            {canEdit ? (
              <select className="wf-modal-input w-full" value={financingOrg} onChange={(e) => setFinancingOrg(e.target.value)}>
                <option value="">— Choisir —</option>
                {ORG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <div className="text-sm font-semibold text-text">{ORG_OPTIONS.find((o) => o.value === financingOrg)?.label ?? financingOrg ?? '—'}</div>
            )}
          </PayField>
        )}
      </div>

      {/* Récap total / reste à payer */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="flex-1 rounded-xl border border-line bg-cream px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Total à payer</div>
          <div className="text-lg font-black text-text">{money(total)}</div>
        </div>
        <div className="flex-1 rounded-xl border border-line bg-cream px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Reste à payer</div>
          <div className={`text-lg font-black ${reste > 0 ? 'text-rouille' : 'text-or-dark'}`}>{money(reste)}</div>
        </div>
      </div>

      {/* Actions de génération selon le type */}
      {canEdit && isEchelonne && lines.length !== nbEcheances && (
        <button type="button" className="fin-action mt-3" onClick={() => generateEcheances(nbEcheances)}>
          Générer {nbEcheances} échéances égales
        </button>
      )}
      {canEdit && isFinancement && lines.length === 0 && (
        <button type="button" className="fin-action mt-3" onClick={initFinancement}>
          Initialiser (acompte comptant + solde financé)
        </button>
      )}

      {/* Liste des paiements */}
      <div className="mt-4 space-y-2">
        {lines.length === 0 ? (
          <p className="text-xs text-faint">Aucun paiement enregistré.</p>
        ) : lines.map((l, i) => (
          <div key={i} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${l.paid ? 'border-or/40 bg-or-tint/30' : 'border-line bg-card'}`}>
            <button
              type="button"
              onClick={() => canEdit && setLine(i, { paid: !l.paid, date: !l.paid && !l.date ? todayIso() : l.date })}
              disabled={!canEdit}
              className={`grid size-6 shrink-0 place-items-center rounded-md border ${l.paid ? 'border-or bg-or text-white' : 'border-line bg-white text-transparent'} ${canEdit ? '' : 'cursor-default'}`}
              title={l.paid ? 'Payé' : 'À payer'}
              aria-label="Payé"
            >
              ✓
            </button>
            {canEdit && !isEchelonne ? (
              <input className="wf-modal-input min-w-0 flex-1" value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} placeholder={`Paiement ${i + 1}`} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{l.label || `Paiement ${i + 1}`}</span>
            )}
            {canEdit ? (
              <input className="wf-modal-input" style={{ width: 96 }} inputMode="decimal" value={l.montant} onChange={(e) => setLine(i, { montant: e.target.value })} placeholder="€" />
            ) : (
              <span className="w-[90px] text-right text-sm font-semibold text-text">{money(l.montant)}</span>
            )}
            {canEdit ? (
              <input className="wf-modal-input" style={{ width: 140 }} type="date" value={l.date} onChange={(e) => setLine(i, { date: e.target.value })} />
            ) : (
              l.date && <span className="text-xs text-faint">{l.date}</span>
            )}
            {canEdit && !isEchelonne && (
              <button type="button" className="fin-action text-rouille" title="Supprimer" onClick={() => removeLine(i)}>✕</button>
            )}
          </div>
        ))}
      </div>

      {canEdit && !isEchelonne && (
        <button type="button" className="fin-action mt-2" onClick={addLine}>+ Ajouter un paiement</button>
      )}

      {error && <p className="wf-modal-error mt-3">{error}</p>}
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
