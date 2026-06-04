import { formatDate } from '../../lib/suivi'
import { attachmentRawUrl } from '../../lib/api'
import { PROJECT_STATUS_LABEL, type ProjectDetailResponse } from '../../lib/types'
import { Section, Empty, DevisRow, AttachmentRow, DebriefCard } from './fiche-parts'

type Props = {
  project: ProjectDetailResponse
  commercialName?: string
}

/**
 * Un « dossier » de projet du client : en-tête (nom, statut, date, commercial)
 * puis les éléments créés par les commerciaux — devis, photos, documents,
 * débriefs — scopés à ce projet.
 */
export function ProjectDossierSection({ project, commercialName }: Props) {
  const photos = project.attachments.filter((a) => a.kind === 'photo')
  const documents = project.attachments.filter((a) => a.kind !== 'photo')
  const debriefs = [...project.debriefs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  return (
    <article className="space-y-6 rounded-2xl border border-line bg-cream p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <h2 className="text-base font-black text-text">{project.name || 'Projet'}</h2>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="rounded-full bg-or-tint px-2 py-0.5 font-bold text-or-dark">
            {PROJECT_STATUS_LABEL[project.status] ?? project.status}
          </span>
          <span>· créé le {formatDate(project.createdAt)}</span>
          {commercialName && <span>· {commercialName}</span>}
        </div>
      </header>

      <Section title="Devis" count={project.devis.length}>
        {project.devis.length === 0 ? (
          <Empty>Aucun devis.</Empty>
        ) : (
          <ul className="space-y-2">
            {project.devis.map((d) => (
              <DevisRow key={d.id} devis={d} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Photos" count={photos.length}>
        {photos.length === 0 ? (
          <Empty>Aucune photo.</Empty>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => window.open(attachmentRawUrl(p.id), '_blank')}
                className="aspect-square overflow-hidden rounded-xl border border-line bg-white"
                title={p.label || p.filename}
              >
                <img
                  src={attachmentRawUrl(p.id)}
                  alt={p.label || p.filename}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Documents" count={documents.length}>
        {documents.length === 0 ? (
          <Empty>Aucun document.</Empty>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <AttachmentRow key={doc.id} attachment={doc} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Débriefs" count={debriefs.length}>
        {debriefs.length === 0 ? (
          <Empty>Aucun débrief.</Empty>
        ) : (
          <div className="space-y-3">
            {debriefs.map((d) => (
              <DebriefCard key={d.id} debrief={d} />
            ))}
          </div>
        )}
      </Section>
    </article>
  )
}
