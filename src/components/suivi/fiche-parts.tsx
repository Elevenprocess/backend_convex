import { useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { formatDate } from '../../lib/suivi'
import { attachmentRawUrl, downloadDevisPdf } from '../../lib/api'
import { DevisScanLoader } from '../devis/DevisScanLoader'
import {
  DEBRIEF_OUTCOME_LABEL,
  PAYMENT_SUB_METHOD_LABEL,
  FINANCING_ORG_LABEL,
  cleanField,
  type Devis,
  type DevisStatus,
  type ProjectAttachmentResponse,
  type DebriefResponse,
} from '../../lib/types'

const FINANCING_TYPE_SHORT: Record<string, string> = {
  comptant: 'Comptant',
  financement: 'Financement',
  financement_sans_apport: 'Financement sans apport',
  apport_financement: 'Apport + financement',
  paiement_10x: 'Paiement 10x',
  paiement_12x: 'Paiement 12x',
}

/**
 * Résume la méthode de paiement / financement saisie au débriefing :
 * type de financement + sous-méthode (chèque/espèces/virement) + organisme
 * (CMOI/Sofider) le cas échéant. Renvoie null si rien n'a été renseigné.
 */
export function formatDebriefFinancing(
  d: Pick<DebriefResponse, 'financingType' | 'paymentSubMethod' | 'financingOrg'>,
): string | null {
  const bits = [
    d.financingType ? FINANCING_TYPE_SHORT[d.financingType] ?? d.financingType : null,
    d.paymentSubMethod ? PAYMENT_SUB_METHOD_LABEL[d.paymentSubMethod] : null,
    d.financingOrg ? FINANCING_ORG_LABEL[d.financingOrg] : null,
  ].filter(Boolean)
  return bits.length > 0 ? bits.join(' · ') : null
}

const DEVIS_STATUS_META: Record<DevisStatus, { label: string; tone: string }> = {
  brouillon: { label: 'Brouillon', tone: 'is-neutral' },
  en_attente: { label: 'En attente', tone: 'is-warn' },
  signature_en_cours: { label: 'Signature en cours', tone: 'is-info' },
  signe: { label: 'Signé', tone: 'is-ok' },
  perdu: { label: 'Perdu', tone: 'is-lost' },
}

export function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-cuivre">
          {title}
          {count != null && count > 0 && (
            <span className="rounded-full bg-or-tint px-1.5 py-0.5 text-[10px] font-semibold text-or-dark">{count}</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Petit bouton « + » des en-têtes de section (Devis, Photos, Documents, Notes). */
export function SectionAddButton({ onClick, label, busy = false }: { onClick: () => void; label: string; busy?: boolean }) {
  return (
    <button type="button" className="fiche-section-add" onClick={onClick} disabled={busy} title={label} aria-label={label}>
      {busy ? <span className="fiche-section-add-spin" aria-hidden /> : <Icon name="plus" size={14} />}
    </button>
  )
}

export function Field({ label, value, href, wide }: { label: string; value: string | null | undefined; href?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="break-words text-[13px] font-medium text-text">
        {value ? (href ? <a href={href} className="text-or-dark hover:text-or">{value}</a> : value) : '—'}
      </dd>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">{children}</div>
}

/** Formate un montant numérique (string BDD ou number) en « 1 234 € ». */
function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toLocaleString('fr-FR')} €` : '—'
}

/** Bloc détaillé d'un devis scanné, affiché quand la carte est « développée ». */
function DevisDetail({ devis }: { devis: Devis }) {
  const lignes = devis.lignes ?? []
  const echeancier = devis.echeancier ?? []
  const financing = devis.financingType ? FINANCING_TYPE_SHORT[devis.financingType] ?? devis.financingType : null
  return (
    <div className="fiche-devis-detail">
      {devis.ocrStatus === 'failed' && (
        <div className="rounded-lg bg-rouille-tint px-3 py-2 text-[11px] font-semibold text-rouille">
          Scan OCR en échec{devis.ocrError ? ` : ${cleanField(devis.ocrError)}` : '.'} — les champs ci-dessous peuvent être vides.
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Field label="Numéro" value={cleanField(devis.devisNumber)} />
        <Field label="Date" value={devis.devisDate ? formatDate(devis.devisDate) : null} />
        <Field label="Expiration" value={devis.dateExpiration ? formatDate(devis.dateExpiration) : null} />
        <Field label="Puissance" value={devis.puissanceKwc ? `${devis.puissanceKwc} kWc` : null} />
        <Field label="Panneaux" value={devis.nbPanneaux != null ? String(devis.nbPanneaux) : null} />
        <Field label="Délai" value={cleanField(devis.delaiExecution)} />
        <Field label="Montant HT" value={devis.montantHt ? fmtMoney(devis.montantHt) : null} />
        <Field label="TVA" value={devis.montantTva ? fmtMoney(devis.montantTva) : null} />
        <Field label="Montant TTC" value={devis.montantTtc ? fmtMoney(devis.montantTtc) : null} />
        <Field label="Net à payer" value={devis.montantNet ? fmtMoney(devis.montantNet) : null} />
        <Field label="Financement" value={financing} />
        <Field label="Prime EDF" value={devis.primeAutoconsommation ? fmtMoney(devis.primeAutoconsommation) : null} />
      </dl>

      {devis.kits && (
        <div className="mt-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-faint">Kit</dt>
          <dd className="text-[12px] font-semibold text-text">{cleanField(devis.kits)}</dd>
        </div>
      )}

      {lignes.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Lignes ({lignes.length})</div>
          <ul className="space-y-1">
            {lignes.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-text">
                  {l.qty ? `${l.qty} × ` : ''}{cleanField(l.designation) ?? '—'}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-text">{fmtMoney(l.totalTtc ?? l.totalHt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {echeancier.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Échéancier ({echeancier.length})</div>
          <ul className="space-y-1">
            {echeancier.map((e, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-muted">{cleanField(e.label) ?? e.phase ?? '—'}</span>
                <span className="shrink-0 font-semibold tabular-nums text-text">{fmtMoney(e.montant)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function DevisRow({
  devis,
  onPreview,
  onDelete,
  deleting = false,
  defaultExpanded = false,
}: {
  devis: Devis
  onPreview?: () => void
  onDelete?: () => void
  deleting?: boolean
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const scanning = devis.ocrStatus === 'pending' || devis.ocrStatus === 'processing'
  const montant = devis.montantTtc ?? devis.montantNet ?? devis.montantHt
  const status = DEVIS_STATUS_META[devis.status] ?? { label: devis.status, tone: 'is-neutral' }
  const meta = [
    devis.puissanceKwc ? `${devis.puissanceKwc} kWc` : null,
    devis.nbPanneaux ? `${devis.nbPanneaux} panneaux` : null,
    devis.devisDate ? formatDate(devis.devisDate) : null,
  ].filter(Boolean)
  return (
    <li className="fiche-devis-card">
      {/* Clic sur le corps de la ligne → aperçu PDF en pop-up (pas de redirection). */}
      <button
        type="button"
        className={`fiche-devis-main${onPreview ? ' is-clickable' : ''}`}
        onClick={onPreview}
        disabled={!onPreview}
        title={onPreview ? 'Aperçu du devis' : undefined}
        style={onPreview ? undefined : { cursor: 'default' }}
      >
        <span className="fiche-devis-icon"><Icon name="tag" size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="fiche-devis-top">
            <span className="fiche-devis-num">{devis.devisNumber || devis.filename}</span>
            <span className={`fiche-devis-status ${status.tone}`}>{status.label}</span>
            {scanning && <span className="fiche-devis-status is-info">Scan OCR…</span>}
          </div>
          {meta.length > 0 && <div className="fiche-devis-meta">{meta.join(' · ')}</div>}
        </div>
      </button>

      {/* Pendant l'OCR : anneau de chargement à la place du détail. */}
      {scanning && <DevisScanLoader ocrStatus={devis.ocrStatus} />}

      <div className="fiche-devis-foot">
        <span className="fiche-devis-amount">{montant ? `${Number(montant).toLocaleString('fr-FR')} €` : '—'}</span>
        <div className="ml-auto flex items-center gap-2">
          {!scanning && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="fiche-devis-dl"
              aria-expanded={expanded}
            >
              <Icon name="chevron-down" size={13} />
              {expanded ? 'Réduire' : 'Développer'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void downloadDevisPdf(devis.id, devis.filename)}
            className="fiche-devis-dl"
          >
            <Icon name="download" size={13} /> PDF
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="fiche-devis-dl text-rouille hover:text-rouille"
              title="Supprimer le devis"
            >
              <Icon name="trash" size={13} /> {deleting ? '…' : 'Supprimer'}
            </button>
          )}
        </div>
      </div>

      {/* Détail développé/réduit (réduit par défaut). */}
      {!scanning && expanded && <DevisDetail devis={devis} />}
    </li>
  )
}

/** Une entrée du journal de notes : aperçu cliquable → pop-up texte complet. */
export function NoteEntryRow({ header, body, onClick }: { header: string | null; body: string; onClick: () => void }) {
  return (
    <button type="button" className="fiche-note-row" onClick={onClick} title="Voir la note">
      {header && <span className="fiche-note-head">{header}</span>}
      <span className="fiche-note-body">{body}</span>
    </button>
  )
}

export function AttachmentRow({
  attachment,
  onDelete,
  deleting = false,
}: {
  attachment: ProjectAttachmentResponse
  onDelete?: () => void
  deleting?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream text-muted">
        <Icon name="tag" size={15} />
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 flex-1 text-left"
        title={attachment.label || attachment.filename}
      >
        <div className="truncate text-[13px] font-medium text-text">{attachment.label || attachment.filename}</div>
        <div className="text-[10px] text-muted">
          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko · {formatDate(attachment.createdAt)}
        </div>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-rouille-tint hover:text-rouille disabled:opacity-60"
          title="Supprimer le document"
          aria-label="Supprimer le document"
        >
          {deleting ? '…' : <Icon name="trash" size={14} />}
        </button>
      )}
      {open && (
        <DocumentPreviewModal
          doc={{ url: attachmentRawUrl(attachment.id), filename: attachment.filename, mimeType: attachment.contentType, label: attachment.label }}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  )
}

export function DebriefCard({ debrief, onClick }: { debrief: DebriefResponse; onClick?: () => void }) {
  const financing = formatDebriefFinancing(debrief)
  const acompte =
    debrief.acompteAmount != null
      ? `acompte ${debrief.acompteAmount} €${debrief.acomptePercent != null ? ` (${debrief.acomptePercent} %)` : ''}`
      : null

  return (
    <article
      className={`fiche-debrief-card${onClick ? ' is-clickable' : ''}`}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } } : {})}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-text">
          Débrief · {DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}
        </span>
        <span className="shrink-0 text-[10px] font-medium text-faint">{formatDate(debrief.createdAt)}</span>
      </div>
      {debrief.notes && <p className="line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{debrief.notes}</p>}
      {debrief.objection && <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-faint">Objection : {debrief.objection}</p>}
      {(financing || acompte) && (
        <p className="mt-1 truncate text-[11px] font-semibold text-faint">
          {[financing, acompte].filter(Boolean).join(' · ')}
        </p>
      )}
      {onClick && <span className="fiche-debrief-more">Voir le détail →</span>}
    </article>
  )
}
