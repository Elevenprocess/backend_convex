import { useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from '../Icon'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { formatDate } from '../../lib/suivi'
import { attachmentRawUrl, downloadDevisPdf } from '../../lib/api'
import {
  DEBRIEF_OUTCOME_LABEL,
  PAYMENT_SUB_METHOD_LABEL,
  FINANCING_ORG_LABEL,
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

const DEVIS_STATUS_META: Record<DevisStatus, { label: string; tone: string }> = {
  brouillon: { label: 'Brouillon', tone: 'is-neutral' },
  en_attente: { label: 'En attente', tone: 'is-warn' },
  signature_en_cours: { label: 'Signature en cours', tone: 'is-info' },
  signe: { label: 'Signé', tone: 'is-ok' },
  perdu: { label: 'Perdu', tone: 'is-lost' },
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-cuivre">
        {title}
        {count != null && count > 0 && (
          <span className="rounded-full bg-or-tint px-1.5 py-0.5 text-[10px] font-black text-or-dark">{count}</span>
        )}
      </h3>
      {children}
    </section>
  )
}

export function Field({ label, value, href, wide }: { label: string; value: string | null | undefined; href?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="break-words text-[13px] font-bold text-text">
        {value ? (href ? <a href={href} className="text-or-dark hover:text-or">{value}</a> : value) : '—'}
      </dd>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">{children}</div>
}

export function DevisRow({ devis }: { devis: Devis }) {
  const montant = devis.montantTtc ?? devis.montantNet ?? devis.montantHt
  const status = DEVIS_STATUS_META[devis.status] ?? { label: devis.status, tone: 'is-neutral' }
  const meta = [
    devis.puissanceKwc ? `${devis.puissanceKwc} kWc` : null,
    devis.nbPanneaux ? `${devis.nbPanneaux} panneaux` : null,
    devis.devisDate ? formatDate(devis.devisDate) : null,
  ].filter(Boolean)
  return (
    <li className="fiche-devis-card">
      <div className="fiche-devis-main">
        <span className="fiche-devis-icon"><Icon name="tag" size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="fiche-devis-top">
            <span className="fiche-devis-num">{devis.devisNumber || devis.filename}</span>
            <span className={`fiche-devis-status ${status.tone}`}>{status.label}</span>
          </div>
          {meta.length > 0 && <div className="fiche-devis-meta">{meta.join(' · ')}</div>}
        </div>
      </div>
      <div className="fiche-devis-foot">
        <span className="fiche-devis-amount">{montant ? `${Number(montant).toLocaleString('fr-FR')} €` : '—'}</span>
        <button
          type="button"
          onClick={() => void downloadDevisPdf(devis.id, devis.filename)}
          className="fiche-devis-dl"
        >
          <Icon name="download" size={13} /> PDF
        </button>
      </div>
    </li>
  )
}

export function AttachmentRow({ attachment }: { attachment: ProjectAttachmentResponse }) {
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
        <div className="truncate text-[13px] font-bold text-text">{attachment.label || attachment.filename}</div>
        <div className="text-[10px] text-muted">
          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko · {formatDate(attachment.createdAt)}
        </div>
      </button>
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
  const financingBits = [
    debrief.financingType ? FINANCING_TYPE_SHORT[debrief.financingType] ?? debrief.financingType : null,
    debrief.paymentSubMethod ? PAYMENT_SUB_METHOD_LABEL[debrief.paymentSubMethod] : null,
    debrief.financingOrg ? FINANCING_ORG_LABEL[debrief.financingOrg] : null,
  ].filter(Boolean)
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
        <span className="text-[13px] font-black text-text">
          Débrief · {DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-faint">{formatDate(debrief.createdAt)}</span>
      </div>
      {debrief.notes && <p className="line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{debrief.notes}</p>}
      {debrief.objection && <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-faint">Objection : {debrief.objection}</p>}
      {(financingBits.length > 0 || acompte) && (
        <p className="mt-1 truncate text-[11px] font-semibold text-faint">
          {[financingBits.join(' · '), acompte].filter(Boolean).join(' · ')}
        </p>
      )}
      {onClick && <span className="fiche-debrief-more">Voir le détail →</span>}
    </article>
  )
}
