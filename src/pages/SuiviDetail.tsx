import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useClients, useLeads, useRdvList, useSubsteps, useUsers } from '../lib/hooks'
import { buildDossiers } from '../lib/suivi'
import { bootstrapClient, updateSubstep } from '../lib/api'
import { todayIso } from '../lib/suivi-board'
import { DossierSidebar } from '../components/suivi/DossierSidebar'
import { TechnicienVtPicker } from '../components/suivi/TechnicienVtPicker'
import { WorkflowBoard } from '../components/suivi/WorkflowBoard'
import { DocumentsHub } from '../components/suivi/DocumentsHub'
import type { UpdateSubstepPatch, WorkflowPhase } from '../lib/types'

export function SuiviDetail() {
  const role = useAuth((s) => s.user?.role)
  const FIELD_PHASES: WorkflowPhase[] = ['vt', 'installation']
  const canEditPhase = (phase: WorkflowPhase) =>
    role === 'technicien' ? FIELD_PHASES.includes(phase) : true
  const { id } = useParams<{ id: string }>()
  const { data: leads, loading: leadsLoading, refetch: refetchLeads } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()

  const dossier = useMemo(() => {
    if (!id || !leads) return null
    return buildDossiers(leads ?? [], rdvs ?? [], users ?? [], {}).find((d) => d.id === id) ?? null
  }, [id, leads, rdvs, users])

  const { data: clients, refetch: refetchClients } = useClients(dossier ? { leadId: dossier.lead.id } : null)
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
    if (!dossier) return
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
  }, [dossier, refetchClients])

  const onMutate = useCallback(async (id: string, patch: UpdateSubstepPatch) => {
    setSavingId(id)
    try {
      await updateSubstep(id, patch)
      refetch()
    } finally {
      setSavingId(null)
    }
  }, [refetch])

  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
    && role !== 'technicien'
  ) return <Navigate to="/overview" replace />
  if (!id) return <Navigate to={role === 'technicien' ? '/mes-dossiers' : '/suivi'} replace />

  const isLoading = leadsLoading || rdvLoading

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Détail dossier" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-breadcrumb">
          <Link to={role === 'technicien' ? '/mes-dossiers' : '/suivi'}>← {role === 'technicien' ? 'Mes dossiers' : 'Tous les dossiers'}</Link>
        </nav>

        {isLoading ? (
          <LoadingBlock label="Chargement du dossier…" />
        ) : !dossier ? (
          <div className="suivi-empty">
            <p>Dossier introuvable.</p>
            <Link to="/suivi">Retour à la liste</Link>
          </div>
        ) : (
          <div className="suivi-split">
            <DossierSidebar dossier={dossier} onLeadUpdated={refetchLeads} />
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
          </div>
        )}
      </main>
    </AppShell>
  )
}
