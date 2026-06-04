import { useCallback, useMemo } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { EmptyState } from '../../components/EmptyState'
import { LoadingBlock } from '../../components/Spinner'
import { useAuth } from '../../lib/auth'
import { useClients } from '../../lib/hooks'
import type { ClientResponse } from '../../lib/types'

export function MesInterventions() {
  const me = useAuth((s) => s.user)
  const navigate = useNavigate()
  // Pour un technicien, GET /clients est déjà scopé côté serveur à ses VT + ses
  // installations (cf. ClientsService.list). On répartit ensuite en deux sections.
  const { data: clients, loading, error } = useClients()

  const openDossier = useCallback(
    (c: ClientResponse) => navigate(`/suivi/${c.leadId}`),
    [navigate],
  )

  const myVt = useMemo(
    () => (clients ?? []).filter((c) => !!me?.id && c.technicienVtId === me.id),
    [clients, me?.id],
  )
  const myInstall = useMemo(
    () => (clients ?? []).filter((c) => !!me?.id && c.steps.installation?.responsableId === me.id),
    [clients, me?.id],
  )

  // Accès : technicien (périmètre scopé serveur) + admin (prévisualisation).
  if (me?.role && me.role !== 'technicien' && me.role !== 'admin') {
    return <Navigate to="/overview" replace />
  }

  return (
    <AppShell flat>
      <Topbar eyebrow="TECHNICIEN" title="Mes interventions" />
      <main className="flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8 space-y-8">
        {loading ? (
          <LoadingBlock label="Chargement de mes interventions…" />
        ) : error ? (
          <div className="py-16 text-center text-rouille text-sm">Erreur : {error}</div>
        ) : (
          <>
            <Section
              title="Mes VT"
              icon="calendar"
              emptyLabel="Aucune VT attribuée"
              clients={myVt}
              onOpen={openDossier}
            />
            <Section
              title="Mes installations"
              icon="grid"
              emptyLabel="Aucune installation attribuée"
              clients={myInstall}
              onOpen={openDossier}
            />
          </>
        )}
      </main>
    </AppShell>
  )
}

function Section({
  title,
  icon,
  emptyLabel,
  clients,
  onOpen,
}: {
  title: string
  icon: 'calendar' | 'grid'
  emptyLabel: string
  clients: ClientResponse[]
  onOpen: (c: ClientResponse) => void
}) {
  return (
    <section aria-label={title}>
      <header className="mb-3 flex items-center gap-2">
        <Icon name={icon} size={16} strokeWidth={1.9} />
        <h2 className="text-sm font-black uppercase tracking-wide text-text">{title}</h2>
        <span className="text-xs text-faint font-semibold">{clients.length}</span>
      </header>
      {clients.length === 0 ? (
        <EmptyState icon="inbox" title={emptyLabel} description="" />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c)}
              className="glass-card !p-4 text-left transition-all w-full h-full hover:bg-white/70 hover:shadow"
            >
              <p className="font-black text-sm text-text truncate" title={c.lead.fullName ?? ''}>
                {c.lead.fullName ?? '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-muted truncate">{c.lead.phone ?? '—'}</p>
              <div className="mt-2 space-y-1 text-[11px] text-muted">
                {c.lead.city && (
                  <div className="flex items-start gap-1.5">
                    <Icon name="map-pin" size={12} className="mt-0.5 shrink-0 text-faint" />
                    <span className="truncate">{c.lead.city}</span>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <Icon name="clock" size={12} className="mt-0.5 shrink-0 text-faint" />
                  <span className="truncate">{c.statusGlobal}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
