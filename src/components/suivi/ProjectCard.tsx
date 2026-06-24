import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/suivi'
import { PROJECT_STATUS_LABEL, type ProjectDetailResponse, type ProjectStatus } from '../../lib/types'
import { Icon } from '../Icon'

// Teinte du badge de statut projet.
const STATUS_TONE: Record<ProjectStatus, string> = {
  qualification: 'bg-line text-muted',
  devis_en_cours: 'bg-cuivre-tint text-cuivre',
  signature_en_cours: 'bg-cuivre-tint text-cuivre',
  signe: 'bg-or-tint text-or-dark',
  perdu: 'bg-rouille-tint text-rouille',
  abandonne: 'bg-rouille-tint text-rouille',
}

/**
 * Carte d'un projet dans la liste de la Fiche client : nom, badge de statut et
 * résumé des pièces. Cliquer ouvre la page dédiée du projet (workflow + dépôts).
 */
export function ProjectCard({
  project, commercialName, to,
}: { project: ProjectDetailResponse; commercialName?: string; to: string }) {
  const photos = project.attachments.filter((a) => a.kind === 'photo').length
  const documents = project.attachments.filter((a) => a.kind !== 'photo').length
  return (
    <Link to={to} className="fiche-project-card group flex items-center gap-4 rounded-2xl border border-line bg-cream p-4 transition-colors hover:border-cuivre">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-base font-semibold text-text">{project.name || 'Projet'}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[project.status] ?? 'bg-line text-muted'}`}>
            {PROJECT_STATUS_LABEL[project.status] ?? project.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {[project.city, commercialName].filter(Boolean).join(' · ') || '—'}
          <span className="text-faint"> · créé le {formatDate(project.createdAt)}</span>
        </p>
        <p className="mt-1.5 text-[11px] font-medium text-faint">
          {project.devis.length} devis · {photos} photos · {documents} documents · {project.debriefs.length} débriefs
        </p>
      </div>
      <Icon name="chevron-right" size={20} className="shrink-0 text-muted transition-colors group-hover:text-cuivre" />
    </Link>
  )
}
