import { useRef, useState } from 'react'
import { formatDate } from '../../lib/suivi'
import { PROJECT_STATUS_LABEL, type DebriefResponse, type Devis, type ProjectDetailResponse } from '../../lib/types'
import { Section, Empty, DevisRow, AttachmentRow, DebriefCard, SectionAddButton, NoteEntryRow } from './fiche-parts'
import { AuthImage } from './AuthImage'
import { PhotoLightbox } from './PhotoLightbox'
import { DebriefDetailModal } from './DebriefDetailModal'
import { DevisPreviewModal } from './DevisPreviewModal'
import { AddNoteModal } from './AddNoteModal'
import { uploadDevis, uploadProjectAttachment, updateProject, pollDevisOcr, deleteDevis } from '../../lib/api'
import { parseNotesJournal, prependNote, type NoteEntry } from '../../lib/notesJournal'
import { useAuth } from '../../lib/auth'

type Props = {
  project: ProjectDetailResponse
  commercialName?: string
  /** Appelé après un ajout (devis/photo/document/note) pour rafraîchir le projet. */
  onChanged?: () => void
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
 * puis les éléments — devis, photos, documents, notes, débriefs — scopés à ce
 * projet. L'équipe delivery peut AJOUTER depuis chaque section (« + ») ; tout
 * s'ouvre en pop-up (aperçu PDF des devis, lightbox photos, détail note/débrief),
 * jamais de redirection.
 */
export function ProjectDossierSection({ project, commercialName, onChanged }: Props) {
  const authorName = useAuth((s) => s.user?.name) ?? 'Inconnu'
  const photos = project.attachments.filter((a) => a.kind === 'photo')
  const documents = project.attachments.filter((a) => a.kind !== 'photo')
  const debriefs = [...project.debriefs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const notes = parseNotesJournal(project.notes)

  const [devisOpen, setDevisOpen] = useState(false)
  const [photosOpen, setPhotosOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [debriefsOpen, setDebriefsOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [selectedDebrief, setSelectedDebrief] = useState<DebriefResponse | null>(null)
  const [previewDevis, setPreviewDevis] = useState<Devis | null>(null)
  const [selectedNote, setSelectedNote] = useState<NoteEntry | null>(null)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  const [busy, setBusy] = useState<null | 'devis' | 'photo' | 'document'>(null)
  const [deletingDevisId, setDeletingDevisId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const devisInput = useRef<HTMLInputElement | null>(null)
  const photoInput = useRef<HTMLInputElement | null>(null)
  const docInput = useRef<HTMLInputElement | null>(null)

  // Devis triés du plus récent au plus ancien : le devis qu'on vient de scanner
  // apparaît en tête (donc toujours visible, même section repliée).
  const sortedDevis = [...project.devis].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const visibleDevis = devisOpen ? sortedDevis : sortedDevis.slice(0, PREVIEW_LIMIT)
  const visiblePhotos = photosOpen ? photos : photos.slice(0, PREVIEW_LIMIT)
  const visibleDocs = docsOpen ? documents : documents.slice(0, PREVIEW_LIMIT)
  const visibleNotes = notesOpen ? notes : notes.slice(0, PREVIEW_LIMIT)
  const visibleDebriefs = debriefsOpen ? debriefs : debriefs.slice(0, PREVIEW_LIMIT)

  async function handleDevisFile(file: File) {
    setBusy('devis')
    setError(null)
    try {
      const created = await uploadDevis(project.leadId, undefined, file, { projectId: project.id })
      // Déplie la section pour que le devis qu'on vient d'ajouter soit visible
      // et affiche tout de suite sa carte en mode « Scan OCR… ».
      setDevisOpen(true)
      onChanged?.()
      // Suit l'OCR en arrière-plan : la fiche est rafraîchie à chaque étape
      // jusqu'à ce que le scan soit terminé (done) ou en échec (failed).
      void pollDevisOcr(created.id, { onTick: () => onChanged?.() }).catch(() => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'ajout du devis.")
    } finally {
      setBusy(null)
    }
  }

  async function handleDeleteDevis(d: Devis) {
    if (!window.confirm(`Supprimer définitivement le devis « ${d.devisNumber || d.filename} » ?`)) return
    setDeletingDevisId(d.id)
    setError(null)
    try {
      await deleteDevis(d.id)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la suppression du devis.')
    } finally {
      setDeletingDevisId(null)
    }
  }

  async function handleAttachmentFile(file: File, kind: 'photo' | 'document') {
    setBusy(kind)
    setError(null)
    try {
      await uploadProjectAttachment(project.id, file, { kind })
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Échec de l'ajout du ${kind === 'photo' ? 'photo' : 'document'}.`)
    } finally {
      setBusy(null)
    }
  }

  async function handleAddNote(text: string) {
    setSavingNote(true)
    setError(null)
    try {
      await updateProject(project.id, { notes: prependNote(project.notes, authorName, text) })
      setNoteModalOpen(false)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'ajout de la note.")
    } finally {
      setSavingNote(false)
    }
  }

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

      {error && (
        <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>
      )}

      {/* Inputs fichiers cachés, déclenchés par les boutons « + ». */}
      <input ref={devisInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleDevisFile(f) }} />
      <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleAttachmentFile(f, 'photo') }} />
      <input ref={docInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleAttachmentFile(f, 'document') }} />

      <Section title="Devis" count={project.devis.length} action={<SectionAddButton label="Ajouter un devis" busy={busy === 'devis'} onClick={() => devisInput.current?.click()} />}>
        {project.devis.length === 0 ? (
          <Empty>Aucun devis.</Empty>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleDevis.map((d) => (
                <DevisRow
                  key={d.id}
                  devis={d}
                  onPreview={() => setPreviewDevis(d)}
                  onDelete={() => void handleDeleteDevis(d)}
                  deleting={deletingDevisId === d.id}
                />
              ))}
            </ul>
            <ShowMore total={project.devis.length} expanded={devisOpen} onToggle={() => setDevisOpen((v) => !v)} noun="devis" />
          </>
        )}
      </Section>

      <Section title="Photos" count={photos.length} action={<SectionAddButton label="Ajouter une photo" busy={busy === 'photo'} onClick={() => photoInput.current?.click()} />}>
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

      <Section title="Documents" count={documents.length} action={<SectionAddButton label="Ajouter un document" busy={busy === 'document'} onClick={() => docInput.current?.click()} />}>
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

      <Section title="Notes" count={notes.length} action={<SectionAddButton label="Ajouter une note" onClick={() => setNoteModalOpen(true)} />}>
        {notes.length === 0 ? (
          <Empty>Aucune note.</Empty>
        ) : (
          <>
            <div className="space-y-2">
              {visibleNotes.map((n, i) => (
                <NoteEntryRow key={i} header={n.header} body={n.body} onClick={() => setSelectedNote(n)} />
              ))}
            </div>
            <ShowMore total={notes.length} expanded={notesOpen} onToggle={() => setNotesOpen((v) => !v)} noun="notes" />
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

      {previewDevis && (
        <DevisPreviewModal devis={previewDevis} onClose={() => setPreviewDevis(null)} />
      )}

      {noteModalOpen && (
        <AddNoteModal onSubmit={handleAddNote} onClose={() => setNoteModalOpen(false)} saving={savingNote} />
      )}

      {selectedNote && (
        <div className="doc-preview-backdrop" role="dialog" aria-modal="true" aria-label="Note" onClick={() => setSelectedNote(null)}>
          <div className="doc-preview" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <header className="doc-preview-head">
              <div className="doc-preview-title"><span className="truncate">{selectedNote.header ?? 'Note'}</span></div>
              <button type="button" className="doc-preview-close" onClick={() => setSelectedNote(null)} aria-label="Fermer">✕</button>
            </header>
            <div className="doc-preview-body" style={{ padding: 16, display: 'block' }}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{selectedNote.body}</p>
            </div>
          </div>
        </div>
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
