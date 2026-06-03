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
import type { UpdateSubstepPatch } from '../lib/types'

export function SuiviDetail() {
  const role = useAuth((s) => s.user?.role)
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
  const today = todayIso()

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
  if (!id) return <Navigate to="/suivi" replace />

  const isLoading = leadsLoading || rdvLoading

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI INSTALLATION" title="Détail dossier" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <nav className="suivi-breadcrumb">
          <Link to="/suivi">← Tous les dossiers</Link>
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
                <header className="suivi-timeline-head">
                  <h2>Workflow installation</h2>
                  <p>Chaque étape a son propre bouton ; DP et Racco/Consuel avancent en parallèle.</p>
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
              ) : (
                <WorkflowBoard substeps={substeps ?? []} onMutate={onMutate} today={today} savingId={savingId} />
              )}
              </section>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}
