import { useEffect, useMemo, useRef, useState } from 'react'
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
import { assignTechniciens, uploadSubstepDocuments, deleteSubstepDocument } from '../../lib/api'
import type { SubstepDocument, SubstepResponse, UpdateSubstepPatch, UserResponse } from '../../lib/types'

type Props = {
  substep: SubstepResponse
  users: UserResponse[]
  today: string
  saving?: boolean
  readOnly?: boolean
  /** ID du client lié à cette sous-étape (pour le multi-assign techniciens). */
  clientId: string
  /** Liste des techniciens déjà assignés au dossier (depuis client.techniciens). */
  assignedTechniciens: { id: string; name: string }[]
  /** Date/heure du module VT planifiée, affichée automatiquement dans Technicien attribué. */
  vtPlanning?: Pick<SubstepResponse, 'dateRealisee' | 'heure'> | null
  onMutate: (id: string, patch: UpdateSubstepPatch) => void
  onDocsChanged?: () => void
  /** Appelé après un changement de liste de techniciens (pour déclencher un refetch client). */
  onTechniciensChanged?: () => void
  onClose: () => void
}

const KIND_LABEL: Record<string, string> = { pdf: 'PDF', image: 'IMG', doc: 'DOC' }

/**
 * Pop-up d'un module du workflow (« nœud » N8N). Toute la saisie d'une
 * sous-étape se fait ici : date, heure, techniciens attribués, notes et dépôt
 * de pièces / photos. Le contenu (titre, icône, pièces attendues) est dérivé
 * du module lui-même, donc chaque type de module a son propre pop-up.
 */
export function SubstepModal({
  substep,
  users,
  today,
  saving,
  readOnly,
  clientId,
  assignedTechniciens,
  vtPlanning,
  onMutate,
  onDocsChanged,
  onTechniciensChanged,
  onClose,
}: Props) {
  const [date, setDate] = useState(substep.dateRealisee ?? '')
  const [heure, setHeure] = useState(substep.heure ?? '')
  const [notes, setNotes] = useState(substep.notes ?? '')
  const [responsable, setResponsable] = useState(substep.responsableId ?? '')
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>(assignedTechniciens.map((t) => t.id))
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SubstepDocument | null>(null)
  const [techSaving, setTechSaving] = useState(false)
  const [techError, setTechError] = useState<string | null>(null)
  const assignedTechIds = useMemo(() => assignedTechniciens.map((t) => t.id), [assignedTechniciens])
  const assignedTechIdsKey = useMemo(() => [...assignedTechIds].sort().join('|'), [assignedTechIds])
  const lastSyncedTechIdsKey = useRef(assignedTechIdsKey)

  // B2 fix: re-sync ALL editable fields (incl. heure) quand le substep change
  // (après refetch post-mutation). substep.id en dep garantit la réinitialisation
  // si on change de sous-étape sans fermer la modale.
  useEffect(() => {
    setDate(substep.dateRealisee ?? '')
    setHeure(substep.heure ?? '')
    setNotes(substep.notes ?? '')
    setResponsable(substep.responsableId ?? '')
  }, [substep.id, substep.dateRealisee, substep.heure, substep.notes, substep.responsableId])

  useEffect(() => {
    lastSyncedTechIdsKey.current = assignedTechIdsKey
    setSelectedTechIds(assignedTechIds)
  }, [substep.id])

  useEffect(() => {
    setSelectedTechIds((current) => {
      const currentKey = [...current].sort().join('|')
      const hasLocalDraft = currentKey !== lastSyncedTechIdsKey.current

      // Après un clic direct sur « Valider », le workflow peut se refetch avant
      // le client. Dans ce court intervalle, assignedTechniciens est encore
      // l'ancienne valeur : ne pas écraser la coche locale avec une prop stale.
      if (hasLocalDraft && assignedTechIdsKey === lastSyncedTechIdsKey.current) {
        return current
      }

      lastSyncedTechIdsKey.current = assignedTechIdsKey
      return assignedTechIds
    })
  }, [assignedTechIds, assignedTechIdsKey])

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
  const showTechnicianSection = isFieldPhase && substep.key !== 'vt_planifie'
  const isTechnicianAssignmentStep = substep.key === 'vt_attribuee'
  const plannedVtDate = isTechnicianAssignmentStep ? (vtPlanning?.dateRealisee ?? null) : null
  const plannedVtHeure = isTechnicianAssignmentStep ? (vtPlanning?.heure ?? null) : null
  // Module « dépôt seul » : sa seule finalité est de recevoir une pièce. On masque
  // Date / Notes / Technicien — il ne reste que la zone de dépôt. La date de
  // réalisation est posée côté backend au jour de l'upload.
  const depositOnly = substep.depositOnly
  // VT planifiée = uniquement date/heure/technicien/notes. Pas de dépôt photo/doc
  // à cette étape : les pièces VT arrivent sur le module « VT validée ».
  const showDocumentSection = substep.key !== 'vt_planifie' && substep.key !== 'vt_attribuee'

  const currentTechIds = assignedTechniciens.map((t) => t.id).sort()
  const draftTechIds = [...selectedTechIds].sort()
  const hasTechnicienChanges = showTechnicianSection && (
    currentTechIds.length !== draftTechIds.length
    || currentTechIds.some((id, index) => id !== draftTechIds[index])
  )

  const hasDraftChanges =
    (!isTechnicianAssignmentStep && date !== (substep.dateRealisee ?? ''))
    || (!isTechnicianAssignmentStep && heure !== (substep.heure ?? ''))
    || notes !== (substep.notes ?? '')
    || hasTechnicienChanges

  const onDateChange = (val: string) => {
    setDate(val)
  }

  const onHeureChange = (val: string) => {
    setHeure(val)
  }

  const onNotesChange = (val: string) => {
    setNotes(val)
  }

  const draftPatch = (): UpdateSubstepPatch => ({
    dateRealisee: isTechnicianAssignmentStep ? (plannedVtDate ?? null) : (date || null),
    heure: isTechnicianAssignmentStep ? (plannedVtHeure ?? null) : (heure || null),
    notes: notes || null,
  })

  const saveTechnicienDraftIfNeeded = async () => {
    if (!hasTechnicienChanges) return
    setTechSaving(true)
    await assignTechniciens(clientId, selectedTechIds)
    onTechniciensChanged?.()
  }

  const onSaveDraft = async () => {
    setTechError(null)
    try {
      await saveTechnicienDraftIfNeeded()
      onMutate(substep.id, draftPatch())
    } catch (e) {
      console.error('[SubstepModal] save draft failed', e)
      setTechError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setTechSaving(false)
    }
  }

  const onToggleDone = async () => {
    setTechError(null)
    try {
      await saveTechnicienDraftIfNeeded()
      if (done) {
        onMutate(substep.id, { ...draftPatch(), status: 'a_faire' })
      } else {
        onMutate(substep.id, {
          ...draftPatch(),
          status: 'fait',
          dateRealisee: isTechnicianAssignmentStep ? (plannedVtDate || date || today) : (date || today),
        })
      }
    } catch (e) {
      console.error('[SubstepModal] validate failed', e)
      setTechError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setTechSaving(false)
    }
  }

  const onCancelSale = () => {
    if (!window.confirm(
      'Marquer la VT comme NON validée ?\n\nLa vente sera ANNULÉE : le dossier passe en « annulé » et les finances de ce client sont remises à zéro (rien à encaisser).',
    )) return
    onMutate(substep.id, { ...draftPatch(), status: 'annule', problemReason: 'vt_invalide' })
  }

  const onReactivate = () => {
    onMutate(substep.id, { ...draftPatch(), status: 'a_faire', problemReason: null })
  }

  const onMarkDpRefusee = () => {
    onMutate(substep.id, { ...draftPatch(), status: 'probleme', problemReason: 'dp_refusee', problemNotes: notes || null })
  }

  const onReopenDp = () => {
    onMutate(substep.id, { ...draftPatch(), status: 'a_faire', problemReason: null, problemNotes: null })
  }

  const onUpload = async (files: File[]) => {
    if (!showDocumentSection) return
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

  // Les techniciens sont un brouillon local : aucune synchro workflow/client tant
  // que l'utilisateur ne clique pas explicitement sur « Enregistrer ».
  const onToggleTechnicien = (techId: string, checked: boolean) => {
    setTechError(null)
    setSelectedTechIds((current) => (
      checked
        ? [...current.filter((id) => id !== techId), techId]
        : current.filter((id) => id !== techId)
    ))
    if (!responsable && checked) setResponsable(techId)
    if (responsable === techId && !checked) setResponsable('')
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
              {!depositOnly && <div><dt>Date</dt><dd>{isTechnicianAssignmentStep ? (plannedVtDate || '—') : (substep.dateRealisee || '—')}</dd></div>}
              {!depositOnly && (isTechnicianAssignmentStep ? plannedVtHeure : substep.heure) && <div><dt>Heure</dt><dd>{isTechnicianAssignmentStep ? plannedVtHeure : substep.heure}</dd></div>}
              {showTechnicianSection && !depositOnly && (
                <div>
                  <dt>Techniciens</dt>
                  <dd>{assignedTechniciens.length > 0 ? assignedTechniciens.map((t) => t.name).join(', ') : '—'}</dd>
                </div>
              )}
              {!depositOnly && <div><dt>Notes</dt><dd>{substep.notes || '—'}</dd></div>}
              {depositOnly && <div><dt>Type</dt><dd>Dépôt de dossier</dd></div>}
            </dl>
          ) : (
            <>
              {!depositOnly && !isTechnicianAssignmentStep && (
                <section className="wf-modal-section">
                  <h3><Icon name="calendar" size={13} /> Date prévue / réalisation</h3>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="wf-modal-input flex-1"
                      value={date}
                      onChange={(e) => onDateChange(e.target.value)}
                    />
                    <input
                      type="time"
                      className="wf-modal-input w-28"
                      value={heure}
                      onChange={(e) => onHeureChange(e.target.value)}
                      placeholder="HH:MM"
                      aria-label="Heure du créneau"
                    />
                  </div>
                </section>
              )}

              {!depositOnly && isTechnicianAssignmentStep && (
                <section className="wf-modal-section">
                  <h3><Icon name="calendar" size={13} /> Créneau VT planifié</h3>
                  <div className="wf-modal-ro">
                    <div><dt>Date</dt><dd>{plannedVtDate || '—'}</dd></div>
                    <div><dt>Heure</dt><dd>{plannedVtHeure || '—'}</dd></div>
                  </div>
                </section>
              )}

              {showTechnicianSection && !depositOnly && (
                <section className="wf-modal-section">
                  <h3><Icon name="users" size={13} /> Techniciens{techSaving ? ' …' : ''}</h3>
                  <ul className="flex flex-col gap-1 mt-1">
                    {techniciens.map((t) => {
                      const checked = selectedTechIds.includes(t.id)
                      return (
                        <li key={t.id} className="flex items-center">
                          <label className="flex items-center gap-2 cursor-pointer text-sm py-1 px-2 rounded hover:bg-black/5 w-full">
                            <input
                              type="checkbox"
                              className="accent-[var(--color-cuivre)] w-4 h-4 cursor-pointer"
                              checked={checked}
                              disabled={techSaving || readOnly}
                              onChange={(e) => onToggleTechnicien(t.id, e.target.checked)}
                            />
                            <span>{t.name}</span>
                          </label>
                        </li>
                      )
                    })}
                    {techniciens.length === 0 && (
                      <li className="text-sm text-gray-400 italic py-1 px-2">Aucun technicien disponible</li>
                    )}
                  </ul>
                  {techError && <p className="wf-modal-error mt-1">{techError}</p>}
                  {/* Champ responsableId maintenu pour compatibilité (1er technicien sélectionné) */}
                  <input
                    type="hidden"
                    value={responsable}
                  />
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
                    onChange={(e) => onNotesChange(e.target.value)}
                  />
                </section>
              )}
            </>
          )}

          {showDocumentSection && (
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
          )}
        </div>

        {!readOnly && (
          <footer className="wf-modal-foot">
            <button type="button" className="wf-cta-ghost" onClick={onClose}>Fermer</button>
            {hasDraftChanges && !depositOnly && (
              <span className="wf-modal-draft" role="status">Modifications non enregistrées</span>
            )}
            {!depositOnly && (
              <button type="button" className="wf-cta-ghost" disabled={!hasDraftChanges || saving || techSaving} onClick={() => void onSaveDraft()}>
                {saving || techSaving ? 'Enregistrement…' : 'Enregistrer les modifications'}
              </button>
            )}
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
                  disabled={(!substep.unlocked && !done) || saving || techSaving}
                  onClick={onToggleDone}
                >
                  {!done && !saving && <Icon name="check" size={15} strokeWidth={2.6} />}
                  {saving ? 'Enregistrement…' : done ? 'Remettre à faire' : substep.actionLabel}
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
