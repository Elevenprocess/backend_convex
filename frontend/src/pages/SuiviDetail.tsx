import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useLeads, useRdvList, useUsers } from '../lib/hooks'
import { buildDossiers } from '../lib/suivi'
import { DossierSidebar } from '../components/suivi/DossierSidebar'
import { DossierWorkflowPanel } from '../components/suivi/DossierWorkflowPanel'

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

  if (role === 'technicien') return <Navigate to="/mes-dossiers" replace />
  if (
    role
    && role !== 'admin'
    && role !== 'delivrabilite'
    && role !== 'responsable_technique'
    && role !== 'back_office'
    && role !== 'finances'
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
            <DossierWorkflowPanel dossier={dossier} />
          </div>
        )}
      </main>
    </AppShell>
  )
}
