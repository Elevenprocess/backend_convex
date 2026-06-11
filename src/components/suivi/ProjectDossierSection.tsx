import { useState } from 'react'
import { formatDate } from '../../lib/suivi'
import { PROJECT_STATUS_LABEL, type DebriefResponse, type ProjectDetailResponse } from '../../lib/types'
import { Section, Empty, DevisRow, AttachmentRow, DebriefCard } from './fiche-parts'
import { AuthImage } from './AuthImage'
import { PhotoLightbox } from './PhotoLightbox'
import { DebriefDetailModal } from './DebriefDetailModal'

type Props = {
  project: ProjectDetailResponse
  commercialName?: string
}

const PREVIEW_LIMIT = 3

/** Bouton « voir plus / voir moins » partagé par les sections de la fiche. */
function ShowMore({ total, expanded, onToggle, noun }: { total: number; expanded: boolean; onToggle: () => void; noun: string }) {
  if (total <= PREVIEW_LIMIT) return null
  return (
    <button type="button" className="fiche-show-more" onClick={onToggle}>
      {expanded ? 'Voir moins' : `Voir ${total - PREVIEW_LIMIT} ${noun} de plus`}
    </button>
  )
}

/**
 * Un « dossier » de projet du client : en-tête (nom, statut, date, commercial)
 * puis les éléments créés par les commerciaux — devis, photos, documents,
 * débriefs — scopés à ce projet. Chaque liste n'affiche que 3 éléments puis
 * propose « voir plus » ; photos en lightbox, débriefs en popup détaillée.
 */
export function ProjectDossierSection({ project, commercialName }: Props) {
  const photos = project.attachments.filter((a) => a.kind === 'photo')
  const documents = project.attachments.filter((a) => a.kind !== 'photo')
  const debriefs = [...project.debriefs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  const [devisOpen, setDevisOpen] = useState(false)
  const [photosOpen, setPhotosOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [debriefsOpen, setDebriefsOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [selectedDebrief, setSelectedDebrief] = useState<DebriefResponse | null>(null)

  const visibleDevis = devisOpen ? project.devis : project.devis.slice(0, PREVIEW_LIMIT)
  const visiblePhotos = photosOpen ? photos : photos.slice(0, PREVIEW_LIMIT)
  const visibleDocs = docsOpen ? documents : documents.slice(0, PREVIEW_LIMIT)
  const visibleDebriefs = debriefsOpen ? debriefs : debriefs.slice(0, PREVIEW_LIMIT)

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
          <>
            <ul className="space-y-2">
              {visibleDevis.map((d) => (
                <DevisRow key={d.id} devis={d} />
              ))}
            </ul>
            <ShowMore total={project.devis.length} expanded={devisOpen} onToggle={() => setDevisOpen((v) => !v)} noun="devis" />
          </>
        )}
      </Section>

      <Section title="Photos" count={photos.length}>
        {photos.length === 0 ? (
          <Empty>Aucune photo.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {visiblePhotos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLightboxIndex(i)}
                  className="fiche-photo-tile"
                  title={p.label || p.filename}
                >
                  <AuthImage attachmentId={p.id} alt={p.label || p.filename} className="fiche-photo-img" />
                </button>
              ))}
            </div>
            <ShowMore total={photos.length} expanded={photosOpen} onToggle={() => setPhotosOpen((v) => !v)} noun="photos" />
          </>
        )}
      </Section>

      <Section title="Documents" count={documents.length}>
        {documents.length === 0 ? (
          <Empty>Aucun document.</Empty>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleDocs.map((doc) => (
                <AttachmentRow key={doc.id} attachment={doc} />
              ))}
            </ul>
            <ShowMore total={documents.length} expanded={docsOpen} onToggle={() => setDocsOpen((v) => !v)} noun="documents" />
          </>
        )}
      </Section>

      <Section title="Débriefs" count={debriefs.length}>
        {debriefs.length === 0 ? (
          <Empty>Aucun débrief.</Empty>
        ) : (
          <>
            <div className="space-y-3">
              {visibleDebriefs.map((d) => (
                <DebriefCard key={d.id} debrief={d} onClick={() => setSelectedDebrief(d)} />
              ))}
            </div>
            <ShowMore total={debriefs.length} expanded={debriefsOpen} onToggle={() => setDebriefsOpen((v) => !v)} noun="débriefs" />
          </>
        )}
      </Section>

      {lightboxIndex != null && photos[lightboxIndex] && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {selectedDebrief && (
        <DebriefDetailModal
          debrief={selectedDebrief}
          commercialName={commercialName}
          onClose={() => setSelectedDebrief(null)}
        />
      )}
    </article>
  )
}
