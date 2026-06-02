import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers } from '../lib/hooks'
import { buildDossiers, readWorkflowState } from '../lib/suivi'
import { DossierSidebar } from '../components/suivi/DossierSidebar'
import { TechnicienVtPicker } from '../components/suivi/TechnicienVtPicker'
import { WorkflowTimeline } from '../components/suivi/WorkflowTimeline'

export function SuiviDetail() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()
  const { data: leads, loading: leadsLoading } = useLeads({ limit: 500 })
  const { data: rdvs, loading: rdvLoading } = useRdvList({ limit: 200 })
  const { data: users } = useUsers()

  const dossier = useMemo(() => {
    if (!id || !leads) return null
    const states = { [id]: readWorkflowState(id) }
    return buildDossiers(leads ?? [], rdvs ?? [], users ?? [], states).find((d) => d.id === id) ?? null
  }, [id, leads, rdvs, users])

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
            <DossierSidebar dossier={dossier} />
            <TechnicienVtPicker leadId={dossier.lead.id} />
            <section id="workflow" className="suivi-timeline-wrap glass-card">
              <header className="suivi-timeline-head">
                <h2>Workflow installation</h2>
                <p>Cliquez une étape pour éditer son avancement. Sauvegarde automatique.</p>
              </header>
              <WorkflowTimeline
                dossierId={dossier.id}
                initialState={dossier.state}
                activeStep={dossier.activeStep}
              />
            </section>
          </div>
        )}
      </main>
    </AppShell>
  )
}
