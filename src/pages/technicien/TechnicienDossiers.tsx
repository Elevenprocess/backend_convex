import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { LoadingBlock } from '../../components/Spinner'
import { useClients } from '../../lib/hooks'
import type { ClientResponse, WorkflowPhase } from '../../lib/types'

const PHASE_LABEL: Record<WorkflowPhase, string> = {
  vt: 'Visite technique', dp: 'Déclaration préalable', racco: 'Raccordement',
  consuel: 'Consuel', installation: 'Installation', mes: 'Mise en service',
}

function nextFieldDate(c: ClientResponse): string | null {
  return c.steps.vt?.datePlanifiee ?? c.steps.installation?.datePlanifiee ?? null
}

export function TechnicienDossiers() {
  const navigate = useNavigate()
  const { data: clients, loading } = useClients({})

  return (
    <AppShell>
      <Topbar eyebrow="MES DOSSIERS" title="Dossiers qui me sont attribués" />
      <main className="p-4 sm:p-6 md:p-8 flex-grow overflow-y-auto">
        {loading && !clients ? (
          <LoadingBlock label="Chargement des dossiers…" />
        ) : !clients || clients.length === 0 ? (
          <p className="text-sm text-muted">Aucun dossier ne vous est attribué pour le moment.</p>
        ) : (
          <ul className="divide-y divide-line-soft glass-card !p-0 overflow-hidden">
            {clients.map((c) => {
              const date = nextFieldDate(c)
              return (
                <li key={c.id}>
                  <button onClick={() => navigate(`/suivi/${c.leadId}`)}
                    className="w-full text-left px-4 py-3 hover:bg-cream/60 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{c.lead.fullName ?? 'Client'}</div>
                      <div className="text-xs text-muted truncate">
                        {[c.lead.city, c.lead.phone].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-muted shrink-0">{PHASE_LABEL[c.currentPhase]}</span>
                    {c.blocked && <span className="text-[10px] font-bold text-rouille shrink-0">bloqué</span>}
                    {date && <span className="text-xs tabular-nums text-muted shrink-0">{date}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </AppShell>
  )
}
