import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LoadingScreen } from '../../components/Spinner'
import { ProjectDetailView } from '../../components/leads/project/ProjectDetailView'
import { useLead } from '../../lib/hooks'
import { getProjectDetail } from '../../lib/api'
import {
  fullName,
  PROJECT_STATUS_LABEL,
  type ProjectResponse,
} from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { leadDetailPath, leadListPath } from '../../lib/leadPaths'

export function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    getProjectDetail(id)
      .then((detail) => {
        if (cancelled) return
        // ProjectDetailView refetch ses propres sous-ressources (devis / débriefs /
        // attachments) — ici on extrait juste la tête de projet pour le shell.
        const { devis: _d, debriefs: _b, attachments: _a, ...head } = detail
        void _d; void _b; void _a
        setProject(head as ProjectResponse)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Projet introuvable')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, refreshKey])

  const { data: lead, refetch: refetchLead } = useLead(project?.leadId)
  // Quand l'enfant signale un changement (refreshKey++), on relit aussi le lead
  // — ainsi le statut affiché dans la fiche client suit instantanément la
  // signature/perte du devis (la synchro côté backend met le lead à jour).
  useEffect(() => {
    if (refreshKey > 0) refetchLead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  if (loading && !project) {
    return (
      <AppShell>
        <Topbar eyebrow="PROJET" title="Chargement…" />
        <LoadingScreen label="Chargement du projet…" />
      </AppShell>
    )
  }

  if (error || !project) {
    return (
      <AppShell>
        <Topbar eyebrow="PROJET" title="Projet introuvable" />
        <main className="p-8 flex items-center justify-center flex-grow">
          <div className="glass-card p-12 text-center">
            <p className="text-muted mb-4">{error ?? "Ce projet n'existe pas (ou plus)."}</p>
            <Link to={leadListPath(role)} className="btn-primary inline-block px-4 py-2 rounded-xl text-sm">
              Retour à la liste
            </Link>
          </div>
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Topbar eyebrow="PROJET" title={project.name} />
      <div className="px-4 sm:px-6 lg:px-10 pt-4 pb-2 flex items-center gap-3 flex-shrink-0 flex-wrap border-b border-line-soft">
        <button
          onClick={() => navigate(leadDetailPath(role, project.leadId))}
          className="inline-flex items-center gap-1.5 text-muted hover:text-text text-[13px] font-medium"
        >
          <Icon name="arrow-left" size={15} />
          {lead ? `Retour fiche ${fullName(lead)}` : 'Retour à la fiche client'}
        </button>
        <div className="ml-auto">
          <span className="inline-flex items-center rounded-md bg-cream px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-or-dark border border-line">
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
        </div>
      </div>

      <main className="px-4 sm:px-6 lg:px-10 py-6 max-w-[1600px] mx-auto w-full overflow-y-auto flex-grow">
        {lead && (
          <ProjectDetailView
            project={project}
            lead={lead}
            onBack={() => navigate(leadDetailPath(role, lead.id))}
            onChanged={(updated) => {
              if (updated) setProject(updated)
              setRefreshKey((k) => k + 1)
            }}
          />
        )}
      </main>
    </AppShell>
  )
}
