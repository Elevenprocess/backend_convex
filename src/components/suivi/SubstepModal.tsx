import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { FileDropzone } from '../FileDropzone'
import { SubstepDocPreviewModal } from './SubstepDocPreviewModal'
import {
  PHASE_ICON,
  PHASE_LABEL,
  SUBSTEP_DESCRIPTION,
  DOC_TYPE_LABEL,
  slaGaugeInfo,
  substepDocStatus,
  fileKind,
} from '../../lib/suivi-board'
import { uploadSubstepDocuments, deleteSubstepDocument } from '../../lib/api'
import type { SubstepDocument, SubstepResponse, UpdateSubstepPatch, UserResponse } from '../../lib/types'

type Props = {
  substep: SubstepResponse
  users: UserResponse[]
  today: string
  saving?: boolean
  readOnly?: boolean
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  onDocsChanged?: () => void
  onClose: () => void
}

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', image: 'IMG', doc: 'DOC' }

/**
 * Pop-up d'un module du workflow (« nœud » N8N). Toute la saisie d'une
 * sous-étape se fait ici : date, technicien attribué, notes et dépôt de
 * pièces / photos. Le contenu (titre, icône, pièces attendues) est dérivé du
 * module lui-même, donc chaque type de module a son propre pop-up.
 */
export function SubstepModal({ substep, users, today, saving, readOnly, onMutate, onDocsChanged, onClose }: Props) {
  const [date, setDate] = useState(substep.dateRealisee ?? '')
  const [notes, setNotes] = useState(substep.notes ?? '')
  const [responsable, setResponsable] = useState(substep.responsableId ?? '')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SubstepDocument | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setDate(substep.dateRealisee ?? '')
    setNotes(substep.notes ?? '')
    setResponsable(substep.responsableId ?? '')
  }, [substep.id, substep.dateRealisee, substep.notes, substep.responsableId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const done = substep.status === 'fait'
  const blocked = substep.status === 'probleme'
  const cancelled = substep.status === 'annule'
  // L'annulation de vente se déclenche depuis la VT validée : si le technicien
  // ne valide pas (projet infaisable), la vente tombe et les finances → 0.
  const canCancelSale = substep.key === 'vt_validee'
  const isDpPhase = substep.phase === 'dp'
  const gauge = slaGaugeInfo(substep.deadline, today)
  const docStatus = substepDocStatus(substep)
  const techniciens = users.filter((u) => u.role === 'technicien')
  // Phases terrain (technicien réel sur site). Les phases back-office (DP, racco,
  // consuel) ne sont que des démarches administratives : pas de technicien à y
  // attribuer — uniquement date, notes et dépôt de pièces / photos.
  const isFieldPhase = substep.phase === 'vt' || substep.phase === 'installation' || substep.phase === 'mes'
  // Module « dépôt seul » : sa seule finalité est de recevoir une pièce. On masque
  // Date / Notes / Technicien — il ne reste que la zone de dépôt. La date de
  // réalisation est posée côté backend au jour de l'upload.
  const depositOnly = substep.depositOnly

  const debounced = (patch: UpdateSubstepPatch) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => onMutate(substep.id, patch), 500)
  }

  const onToggleDone = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    if (done) onMutate(substep.id, { status: 'a_faire' })
    else onMutate(substep.id, { status: 'fait', dateRealisee: date || today })
  }

  const onCancelSale = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    if (!window.confirm(
      'Marquer la VT comme NON validée ?\n\nLa vente sera ANNULÉE : le dossier passe en « annulé » et les finances de ce client sont remises à zéro (rien à encaisser).',
    )) return
    onMutate(substep.id, { status: 'annule', problemReason: 'vt_invalide' })
  }

  const onReactivate = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    onMutate(substep.id, { status: 'a_faire', problemReason: null })
  }

  const onMarkDpRefusee = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    onMutate(substep.id, { status: 'probleme', problemReason: 'dp_refusee', problemNotes: notes || null })
  }

  const onReopenDp = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    onMutate(substep.id, { status: 'a_faire', problemReason: null, problemNotes: null })
  }

  const onUpload = async (files: File[]) => {
    setUploading(true)
    setUploadError(null)
    try {
      await uploadSubstepDocuments(substep.id, files)
      onDocsChanged?.()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Échec du dépôt")
    } finally {
      setUploading(false)
    }
  }

  const onDeleteDoc = async (docId: string) => {
    await deleteSubstepDocument(docId)
    onDocsChanged?.()
  }

  const statusLabel = cancelled ? 'Vente annulée' : done ? 'Terminé' : blocked ? 'Blocage' : substep.unlocked ? 'En cours' : 'En attente'
  const statusTone = cancelled || blocked ? 'is-blocked' : done ? 'is-done' : substep.unlocked ? 'is-active' : 'is-locked'

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label={substep.label} onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="wf-modal-head-main">
            <span className={`wf-modal-icon ${statusTone}`} aria-hidden>
              <Icon name={PHASE_ICON[substep.phase]} size={18} />
            </span>
            <div className="min-w-0">
              <span className="eyebrow text-or-dark">{PHASE_LABEL[substep.phase]}</span>
              <h2>{substep.label}{substep.optional ? ' (optionnel)' : ''}</h2>
              <p className="fiche-modal-sub">
                <span className={`wf-modal-status ${statusTone}`}>{statusLabel}</span>
                {gauge && <span className={`wf-gauge wf-gauge-${gauge.tone}`}><Icon name="clock" size={12} /> {gauge.label}</span>}
              </p>
            </div>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          {SUBSTEP_DESCRIPTION[substep.key] && (
            <p className="fiche-modal-text">{SUBSTEP_DESCRIPTION[substep.key]}</p>
          )}

          {cancelled && (
            <p className="wf-cancel-note"><Icon name="x" size={14} /> Vente annulée — VT non validée. Le dossier est bloqué et les finances de ce client sont à zéro (rien à encaisser).</p>
          )}

          {!cancelled && !substep.unlocked && !done && (
            <p className="wf-locked-note"><Icon name="shield" size={13} /> Ce module se débloquera une fois l'étape précédente terminée.</p>
          )}

          {readOnly ? (
            <dl className="wf-modal-ro">
              {!depositOnly && <div><dt>Date</dt><dd>{substep.dateRealisee || '—'}</dd></div>}
              {isFieldPhase && !depositOnly && (
                <div><dt>Technicien</dt><dd>{techniciens.find((t) => t.id === substep.responsableId)?.name ?? '—'}</dd></div>
              )}
              {!depositOnly && <div><dt>Notes</dt><dd>{substep.notes || '—'}</dd></div>}
              {depositOnly && <div><dt>Type</dt><dd>Dépôt de dossier</dd></div>}
            </dl>
          ) : (
            <>
              {!depositOnly && (
                <section className="wf-modal-section">
                  <h3><Icon name="calendar" size={13} /> Date prévue / réalisation</h3>
                  <input
                    type="date"
                    className="wf-modal-input"
                    value={date}
                    onChange={(e) => { setDate(e.target.value); debounced({ dateRealisee: e.target.value || null }) }}
                  />
                </section>
              )}

              {isFieldPhase && !depositOnly && (
                <section className="wf-modal-section">
                  <h3><Icon name="users" size={13} /> Technicien attribué</h3>
                  <select
                    className="wf-modal-input"
                    value={responsable}
                    onChange={(e) => { setResponsable(e.target.value); onMutate(substep.id, { responsableId: e.target.value || null }) }}
                  >
                    <option value="">Aucun — à attribuer</option>
                    {techniciens.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </section>
              )}

              {!depositOnly && (
                <section className="wf-modal-section">
                  <h3><Icon name="edit" size={13} /> Notes</h3>
                  <textarea
                    className="wf-modal-input"
                    rows={3}
                    value={notes}
                    placeholder="Notes internes, blocages, contact…"
                    onChange={(e) => { setNotes(e.target.value); debounced({ notes: e.target.value || null }) }}
                  />
                </section>
              )}
            </>
          )}

          <section className="wf-modal-section">
            <h3><Icon name="tag" size={13} /> Pièces & photos{docStatus.present.length + docStatus.missingTypes.length > 0 ? ` · ${docStatus.present.length}/${docStatus.present.length + docStatus.missingTypes.length}` : ''}</h3>

            {(docStatus.present.length > 0 || docStatus.missingTypes.length > 0) && (
              <ul className="wf-modal-docs">
                {docStatus.present.map((d) => (
                  <li key={d.id} className="wf-modal-doc">
                    <span className={`dochub-thumb kind-${fileKind(d.mimeType)}`}>{KIND_LABEL[fileKind(d.mimeType)]}</span>
                    <button type="button" className="wf-modal-doc-name" onClick={() => setPreview(d)} title={d.filename}>{d.filename}</button>
                    <span className="wf-modal-doc-meta">{Math.max(1, Math.round(d.sizeBytes / 1024))} Ko</span>
                    {!readOnly && (
                      <button type="button" className="dochub-doc-del" aria-label="Supprimer" onClick={() => void onDeleteDoc(d.id)}>
                        <Icon name="x" size={13} />
                      </button>
                    )}
                  </li>
                ))}
                {docStatus.missingTypes.map((t) => (
                  <li key={t} className="wf-modal-doc is-missing">
                    <span className="dochub-thumb kind-missing">—</span>
                    <span className="wf-modal-doc-name" title={DOC_TYPE_LABEL[t] ?? t}>{DOC_TYPE_LABEL[t] ?? t}</span>
                    <span className="wf-modal-missing-pill">manquante</span>
                  </li>
                ))}
              </ul>
            )}

            {!readOnly && (
              <>
                <FileDropzone
                  id={`wf-modal-drop-${substep.id}`}
                  multiple
                  title="Déposer un dossier ou une photo"
                  subtitle="PDF, images… · 25 Mo / fichier"
                  onFiles={(files) => void onUpload(files)}
                />
                {uploading && <p className="wf-modal-hint">Dépôt en cours…</p>}
                {uploadError && <p className="wf-modal-error">{uploadError}</p>}
              </>
            )}
          </section>
        </div>

        {!readOnly && (
          <footer className="wf-modal-foot">
            <button type="button" className="wf-cta-ghost" onClick={onClose}>Fermer</button>
            {cancelled ? (
              <button type="button" className="wf-cta-primary" disabled={saving} onClick={onReactivate}>
                {saving ? 'Enregistrement…' : 'Réactiver la vente'}
              </button>
            ) : isDpPhase && blocked ? (
              <>
                <button type="button" className="wf-cta-primary" disabled={saving} onClick={onReopenDp}>
                  {saving ? 'Enregistrement…' : 'DP acceptée — rouvrir'}
                </button>
              </>
            ) : (
              <>
                {canCancelSale && (
                  <button type="button" className="wf-cta-danger" disabled={saving} onClick={onCancelSale}>
                    <Icon name="x" size={15} strokeWidth={2.6} /> VT non validée
                  </button>
                )}
                {isDpPhase && !done && !cancelled && (
                  <button type="button" className="wf-cta-danger" disabled={saving} onClick={onMarkDpRefusee}>
                    <Icon name="x" size={15} strokeWidth={2.6} /> Refusée (retour mairie)
                  </button>
                )}
                <button
                  type="button"
                  className={done ? 'wf-cta-ghost' : 'wf-cta-primary'}
                  disabled={(!substep.unlocked && !done) || saving}
                  onClick={onToggleDone}
                >
                  {!done && !saving && <Icon name="check" size={15} strokeWidth={2.6} />}
                  {saving ? 'Enregistrement…' : done ? 'Rouvrir le module' : substep.actionLabel}
                </button>
              </>
            )}
          </footer>
        )}

        {preview && <SubstepDocPreviewModal doc={preview} onClose={() => setPreview(null)} />}
      </div>
    </div>
  )
}
