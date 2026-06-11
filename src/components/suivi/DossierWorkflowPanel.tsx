import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useClients, useSubsteps } from '../../lib/hooks'
import { bootstrapClient, updateSubstep } from '../../lib/api'
import { todayIso } from '../../lib/suivi-board'
import type { Dossier } from '../../lib/suivi'
import type { UpdateSubstepPatch, WorkflowPhase } from '../../lib/types'
import { TechnicienVtPicker } from './TechnicienVtPicker'
import { WorkflowBoard } from './WorkflowBoard'
import { DocumentsHub } from './DocumentsHub'

type Props = {
  dossier: Dossier
}

/**
 * Colonne « workflow » d'un dossier : sélection technicien VT, onglets
 * Workflow / Documents et bootstrap du dossier. Extrait de SuiviDetail pour
 * être réutilisé tel quel dans la page détail et dans le drawer de la fiche.
 */
export function DossierWorkflowPanel({ dossier }: Props) {
  const role = useAuth((s) => s.user?.role)
  const FIELD_PHASES: WorkflowPhase[] = ['vt', 'installation']
  const canEditPhase = (phase: WorkflowPhase) =>
    role === 'technicien' ? FIELD_PHASES.includes(phase) : true

  const { data: clients, refetch: refetchClients } = useClients({ leadId: dossier.lead.id })
  const client = clients?.[0] ?? null
  const { data: substeps, loading: substepsLoading, refetch } = useSubsteps(client ? { clientId: client.id } : null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [view, setView] = useState<'workflow' | 'documents'>('workflow')
  const today = todayIso()

  const docCounts = useMemo(() => {
    const list = substeps ?? []
    let present = 0
    let expected = 0
    for (const s of list) {
      expected += s.expectedDocs.length
      const presentTypes = new Set(s.documents.map((d) => d.type))
      present += s.expectedDocs.filter((t) => presentTypes.has(t)).length
    }
    return { present, expected }
  }, [substeps])

  const canInitDossier = role === 'admin' || role === 'responsable_technique' || role === 'back_office' || role === 'delivrabilite'

  const onInitDossier = useCallback(async () => {
    setInitializing(true)
    setInitError(null)
    try {
      await bootstrapClient(dossier.lead.id)
      refetchClients()
    } catch (e) {
      setInitError(e instanceof Error ? e.message : 'Échec de l’initialisation du dossier')
    } finally {
      setInitializing(false)
    }
  }, [dossier.lead.id, refetchClients])

  const onMutate = useCallback(async (id: string, patch: UpdateSubstepPatch) => {
    setSavingId(id)
    try {
      await updateSubstep(id, patch)
      refetch()
    } finally {
      setSavingId(null)
    }
  }, [refetch])

  return (
    <div className="suivi-main-col">
      <TechnicienVtPicker leadId={dossier.lead.id} />
      <section id="workflow" className="suivi-timeline-wrap">
        <header className="suivi-timeline-head suivi-detail-sticky">
          <div className="suivi-detail-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'workflow'}
              className={view === 'workflow' ? 'is-active' : ''} onClick={() => setView('workflow')}>
              Workflow
            </button>
            <button type="button" role="tab" aria-selected={view === 'documents'}
              className={view === 'documents' ? 'is-active' : ''} onClick={() => setView('documents')}>
              Documents {docCounts.expected > 0 && <span className="suivi-tab-count">{docCounts.present}/{docCounts.expected}</span>}
            </button>
          </div>
        </header>
        {!client ? (
          <div className="wf-init">
            <p className="wf-empty">Dossier pas encore initialisé (aucun client lié à ce lead).</p>
            {canInitDossier && (
              <>
                <button type="button" className="btn-primary" onClick={onInitDossier} disabled={initializing}>
                  {initializing ? 'Initialisation…' : 'Initialiser le dossier'}
                </button>
                {initError && <p className="wf-init-error">{initError}</p>}
              </>
            )}
          </div>
        ) : (substeps == null && substepsLoading) ? (
          <p className="wf-empty">Chargement du workflow…</p>
        ) : view === 'documents' ? (
          <DocumentsHub substeps={substeps ?? []} today={today} onDocsChanged={refetch} />
        ) : (
          <WorkflowBoard substeps={substeps ?? []} onMutate={onMutate} today={today} savingId={savingId} onDocsChanged={refetch} onGoToDocs={() => setView('documents')} canEditPhase={canEditPhase} />
        )}
      </section>
    </div>
  )
}
