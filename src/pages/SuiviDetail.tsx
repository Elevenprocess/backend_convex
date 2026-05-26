import { Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { useAuth } from '../lib/auth'

export function SuiviDetail() {
  const role = useAuth((s) => s.user?.role)
  const { id } = useParams<{ id: string }>()

  if (role && role !== 'admin' && role !== 'delivrabilite') {
    return <Navigate to="/overview" replace />
  }
  if (!id) return <Navigate to="/suivi" replace />

  return (
    <AppShell flat>
      <Topbar eyebrow="SUIVI" title="Détail dossier" />
      <main className="suivi-v2-detail flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <p>Placeholder dossier {id}</p>
      </main>
    </AppShell>
  )
}
