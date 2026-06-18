import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../../lib/suivi'
import { PROJECT_STATUS_LABEL, type DebriefResponse, type Devis, type ProjectDetailResponse } from '../../lib/types'
import { Section, Empty, DevisRow, AttachmentRow, DebriefCard, SectionAddButton, NoteEntryRow } from './fiche-parts'
import { Icon } from '../Icon'
import { AuthImage } from './AuthImage'
import { PhotoLightbox } from './PhotoLightbox'
import { DebriefDetailModal } from './DebriefDetailModal'
import { DevisPreviewModal } from './DevisPreviewModal'
import { AddNoteModal } from './AddNoteModal'
import { uploadDevis, uploadProjectAttachment, updateProject, pollDevisOcr, deleteDevis, deleteProjectAttachment } from '../../lib/api'
import { parseNotesJournal, prependNote, type NoteEntry } from '../../lib/notesJournal'
import { useAuth } from '../../lib/auth'
import { useCollapsibleState } from '../../lib/useCollapsibleState'
import { DossierWorkflowPanel } from './DossierWorkflowPanel'
import type { Dossier } from '../../lib/suivi'

type Props = {
  project: ProjectDetailResponse
  commercialName?: string
  /** Dossier du client : permet d'afficher son workflow quand le projet est déployé. */
  dossier: Dossier
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
export function ProjectDossierSection({ project, commercialName, dossier, onChanged }: Props) {
  const authorName = useAuth((s) => s.user?.name) ?? 'Inconnu'
  // Chaque projet est replié par défaut : on ne déploie ses pièces qu'à la
  // sélection. État mémorisé par projet.
  const [collapsed, toggleCollapsed] = useCollapsibleState(`fiche.project.${project.id}`, true)
  // Le workflow délivrabilité s'ouvre dans un pop-up, via le bouton « Voir workflow ».
  const [workflowOpen, setWorkflowOpen] = useState(false)

  useEffect(() => {
    if (!workflowOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWorkflowOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [workflowOpen])
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
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
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

  async function handleDeleteAttachment(id: string, kind: 'photo' | 'document', name: string) {
    const noun = kind === 'photo' ? 'la photo' : 'le document'
    if (!window.confirm(`Supprimer ${noun} « ${name} » ?`)) return
    setDeletingAttachmentId(id)
    setError(null)
    try {
      await deleteProjectAttachment(id)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Échec de la suppression de ${noun}.`)
    } finally {
      setDeletingAttachmentId(null)
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
      <header className={collapsed ? '' : 'border-b border-line pb-3'}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex flex-1 items-center gap-3 text-left"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={18} className="shrink-0 text-muted" />
            <div className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-text">{project.name || 'Projet'}</h2>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="rounded-full bg-or-tint px-2 py-0.5 font-medium text-or-dark">
                  {PROJECT_STATUS_LABEL[project.status] ?? project.status}
                </span>
                <span>· créé le {formatDate(project.createdAt)}</span>
                {commercialName && <span>· {commercialName}</span>}
              </div>
            </div>
            <span className="shrink-0 text-xs font-medium text-or-dark">{collapsed ? 'Développer' : 'Réduire'}</span>
          </button>
          <button type="button" className="fiche-wf-open-btn shrink-0" onClick={() => setWorkflowOpen(true)}>
            <span>Voir workflow</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        {collapsed && (
          <p className="mt-2 pl-[30px] text-xs text-muted">
            {project.devis.length} devis · {photos.length} photos · {documents.length} documents · {notes.length} notes · {debriefs.length} débriefs
          </p>
        )}
      </header>

      {!collapsed && (
      <>
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
                <div key={p.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(i)}
                    className="fiche-photo-tile"
                    title={p.label || p.filename}
                  >
                    <AuthImage attachmentId={p.id} alt={p.label || p.filename} className="fiche-photo-img" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAttachment(p.id, 'photo', p.label || p.filename)}
                    disabled={deletingAttachmentId === p.id}
                    className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-rouille focus:opacity-100 group-hover:opacity-100 disabled:opacity-60"
                    title="Supprimer la photo"
                    aria-label="Supprimer la photo"
                  >
                    {deletingAttachmentId === p.id ? '…' : <Icon name="trash" size={12} />}
                  </button>
                </div>
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
                <AttachmentRow
                  key={doc.id}
                  attachment={doc}
                  onDelete={() => void handleDeleteAttachment(doc.id, 'document', doc.label || doc.filename)}
                  deleting={deletingAttachmentId === doc.id}
                />
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
      </>
      )}

      {workflowOpen && (
        <div className="fiche-wf-drawer-backdrop" onClick={() => setWorkflowOpen(false)}>
          <aside
            className="fiche-wf-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Workflow délivrabilité"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="fiche-wf-drawer-head">
              <div className="min-w-0">
                <span className="eyebrow text-or-dark">Workflow délivrabilité</span>
                <h2 className="truncate">{project.name || 'Projet'}</h2>
              </div>
              <button type="button" className="fiche-wf-drawer-close" onClick={() => setWorkflowOpen(false)} aria-label="Fermer le workflow">✕</button>
            </header>
            <div className="fiche-wf-drawer-body">
              <DossierWorkflowPanel dossier={dossier} projectId={project.id} />
            </div>
          </aside>
        </div>
      )}

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
