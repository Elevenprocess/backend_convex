import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { useDossier } from '../lib/useDossier'
import { useClients } from '../lib/hooks'
import { getProjectDetail, updateFinancing } from '../lib/api'
import { parseNotesJournal } from '../lib/notesJournal'
import { formatCurrency } from '../lib/suivi'
import { fullName, PROJECT_STATUS_LABEL, type DebriefResponse, type ProjectDetailResponse, type UpdateFinancingPatch } from '../lib/types'
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
                  <PaymentPanel project={project} onSaved={refresh} />
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

const FINANCING_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'financement', label: 'Financement' },
  { value: 'comptant', label: 'Au comptant' },
  { value: 'paiement_10x', label: 'Paiement x10' },
  { value: 'paiement_12x', label: 'Paiement x12' },
]

/**
 * Onglet « Mode de paiement » : financement/comptant dérivé du débrief de vente.
 * Le responsable technique / back-office (et l'admin) peut le MODIFIER — les
 * données sont sur le débrief, mises à jour via l'endpoint financing.
 */
function PaymentPanel({ project, onSaved }: { project: ProjectDetailResponse; onSaved: () => void }) {
  const role = useAuth((s) => s.user?.role)
  const canEdit = role === 'admin' || role === 'responsable_technique' || role === 'back_office'
  const [editing, setEditing] = useState(false)

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

  if (editing) {
    return (
      <PaymentEditForm
        debrief={debrief}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onSaved() }}
      />
    )
  }

  const financing = formatDebriefFinancingType(debrief)
  const method = formatDebriefPaymentMethod(debrief)
  const acompte = debrief.acompteAmount
    ? `${Number(debrief.acompteAmount).toLocaleString('fr-FR')} €${debrief.acomptePercent != null ? ` (${debrief.acomptePercent} %)` : ''}`
    : (debrief.acomptePercent != null ? `${debrief.acomptePercent} %` : null)

  return (
    <Section
      title="Mode de paiement"
      action={canEdit ? (
        <button type="button" className="text-xs font-semibold text-or hover:underline" onClick={() => setEditing(true)}>
          ✎ Modifier
        </button>
      ) : undefined}
    >
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

/** Formulaire d'édition du mode de paiement (patch par diff vers le débrief). */
function PaymentEditForm({
  debrief, onCancel, onSaved,
}: { debrief: DebriefResponse; onCancel: () => void; onSaved: () => void }) {
  const [montantTotal, setMontantTotal] = useState(debrief.montantTotal ?? '')
  const [financingType, setFinancingType] = useState(debrief.financingType ?? '')
  const [paymentSubMethod, setPaymentSubMethod] = useState(debrief.paymentSubMethod ?? '')
  const [financingOrg, setFinancingOrg] = useState(debrief.financingOrg ?? '')
  const [acomptePercent, setAcomptePercent] = useState(debrief.acomptePercent != null ? String(debrief.acomptePercent) : '')
  const [acompteAmount, setAcompteAmount] = useState(debrief.acompteAmount ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const patch: UpdateFinancingPatch = {}
      const t = (v: string) => v.trim()
      if (t(montantTotal) !== (debrief.montantTotal ?? '')) patch.montantTotal = t(montantTotal) || null
      if (t(financingType) !== (debrief.financingType ?? '')) patch.financingType = t(financingType) || null
      if (t(paymentSubMethod) !== (debrief.paymentSubMethod ?? '')) patch.paymentSubMethod = t(paymentSubMethod) || null
      if (t(financingOrg) !== (debrief.financingOrg ?? '')) patch.financingOrg = t(financingOrg) || null
      const pctInit = debrief.acomptePercent != null ? String(debrief.acomptePercent) : ''
      if (t(acomptePercent) !== pctInit) patch.acomptePercent = t(acomptePercent) ? Number(t(acomptePercent)) : null
      if (t(acompteAmount) !== (debrief.acompteAmount ?? '')) patch.acompteAmount = t(acompteAmount) || null
      if (Object.keys(patch).length === 0) { onCancel(); return }
      await updateFinancing(debrief.id, patch)
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
      action={(
        <div className="flex items-center gap-2">
          <button type="button" className="text-xs font-semibold text-or hover:underline disabled:opacity-50" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" className="text-xs font-medium text-muted hover:underline disabled:opacity-50" onClick={onCancel} disabled={saving}>
            Annuler
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <PayField label="Montant total (€)">
          <input className="wf-modal-input w-full" inputMode="decimal" value={montantTotal} onChange={(e) => setMontantTotal(e.target.value)} placeholder="ex : 12000" />
        </PayField>
        <PayField label="Type de financement">
          <select className="wf-modal-input w-full" value={financingType} onChange={(e) => setFinancingType(e.target.value)}>
            <option value="">— Non renseigné —</option>
            {FINANCING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </PayField>
        <PayField label="Méthode (comptant)">
          <select className="wf-modal-input w-full" value={paymentSubMethod} onChange={(e) => setPaymentSubMethod(e.target.value)}>
            <option value="">—</option>
            <option value="cheque">Chèque</option>
            <option value="especes">Espèces</option>
            <option value="virement">Virement</option>
          </select>
        </PayField>
        <PayField label="Organisme de financement">
          <input className="wf-modal-input w-full" value={financingOrg} onChange={(e) => setFinancingOrg(e.target.value)} placeholder="ex : cmoi, sofider" />
        </PayField>
        <PayField label="Acompte — %">
          <input className="wf-modal-input w-full" inputMode="numeric" value={acomptePercent} onChange={(e) => setAcomptePercent(e.target.value)} placeholder="ex : 40" />
        </PayField>
        <PayField label="Acompte — montant (€)">
          <input className="wf-modal-input w-full" inputMode="decimal" value={acompteAmount} onChange={(e) => setAcompteAmount(e.target.value)} placeholder="ex : 6000" />
        </PayField>
      </div>
      {error && <p className="wf-modal-error mt-2">{error}</p>}
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
