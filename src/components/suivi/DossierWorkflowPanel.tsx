import { useCallback, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useClients, useSubsteps, useUsers } from '../../lib/hooks'
import { bootstrapClient, bootstrapClientForProject, updateSubstep } from '../../lib/api'
import { todayIso } from '../../lib/suivi-board'
import type { Dossier } from '../../lib/suivi'
import type { UpdateSubstepPatch, WorkflowPhase } from '../../lib/types'
import { WorkflowBoard } from './WorkflowBoard'

type Props = {
  dossier: Dossier
  /**
   * Quand fourni, le workflow est scopé à CE projet (dossier indépendant par
   * projet). Sinon, fallback legacy scopé au lead (page détail historique).
   */
  projectId?: string
}

/**
 * Colonne « workflow » d'un dossier : sélection technicien VT, onglets
 * Workflow / Documents et bootstrap du dossier. Extrait de SuiviDetail pour
 * être réutilisé tel quel dans la page détail et dans le drawer de la fiche.
 */
export function DossierWorkflowPanel({ dossier, projectId }: Props) {
  const role = useAuth((s) => s.user?.role)
  const FIELD_PHASES: WorkflowPhase[] = ['vt', 'installation']
  // Commercial / commercial_lead et finances : LECTURE SEULE. Technicien :
  // terrain uniquement. Délivrabilité / admin : édition complète.
  const canEditPhase = (phase: WorkflowPhase) =>
    role === 'finances' || role === 'commercial' || role === 'commercial_lead' ? false
      : role === 'technicien' ? FIELD_PHASES.includes(phase)
        : true

  // Scoping par projet si projectId fourni (workflow indépendant par projet),
  // sinon par lead (dossier legacy de la page détail).
  const { data: clients, refetch: refetchClients } = useClients(
    projectId ? { projectId } : { leadId: dossier.lead.id },
  )
  const { data: users } = useUsers()
  const client = clients?.[0] ?? null
  const { data: substeps, loading: substepsLoading, refetch } = useSubsteps(client ? { clientId: client.id } : null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const today = todayIso()

  const canInitDossier = role === 'admin' || role === 'responsable_technique' || role === 'back_office' || role === 'delivrabilite'

  const onInitDossier = useCallback(async () => {
    setInitializing(true)
    setInitError(null)
    try {
      await (projectId ? bootstrapClientForProject(projectId) : bootstrapClient(dossier.lead.id))
      refetchClients()
    } catch (e) {
      setInitError(e instanceof Error ? e.message : 'Échec de l’initialisation du dossier')
    } finally {
      setInitializing(false)
    }
  }, [projectId, dossier.lead.id, refetchClients])

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
      <section id="workflow" className="suivi-timeline-wrap">
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
        ) : (
          <WorkflowBoard substeps={substeps ?? []} onMutate={onMutate} today={today} users={users ?? []} savingId={savingId} onDocsChanged={refetch} canEditPhase={canEditPhase} />
        )}
      </section>
    </div>
  )
}
