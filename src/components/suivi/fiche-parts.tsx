import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { formatDate } from '../../lib/suivi'
import { attachmentRawUrl, downloadDevisPdf } from '../../lib/api'
import {
  DEBRIEF_OUTCOME_LABEL,
  type Devis,
  type ProjectAttachmentResponse,
  type DebriefResponse,
} from '../../lib/types'

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
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-or-tint text-or-dark">
        <Icon name="tag" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold text-text">{devis.devisNumber || devis.filename}</div>
        <div className="text-[10px] text-muted">
          {montant ? `${Number(montant).toLocaleString('fr-FR')} €` : '—'} · {devis.status}
          {devis.devisDate ? ` · ${formatDate(devis.devisDate)}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void downloadDevisPdf(devis.id, devis.filename)}
        className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-muted transition-colors hover:bg-cream hover:text-text"
      >
        <Icon name="download" size={13} />
      </button>
    </li>
  )
}

export function AttachmentRow({ attachment }: { attachment: ProjectAttachmentResponse }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cream text-muted">
        <Icon name="tag" size={15} />
      </span>
      <button
        type="button"
        onClick={() => window.open(attachmentRawUrl(attachment.id), '_blank')}
        className="min-w-0 flex-1 text-left"
        title={attachment.label || attachment.filename}
      >
        <div className="truncate text-[13px] font-bold text-text">{attachment.label || attachment.filename}</div>
        <div className="text-[10px] text-muted">
          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko · {formatDate(attachment.createdAt)}
        </div>
      </button>
    </li>
  )
}

export function DebriefCard({ debrief }: { debrief: DebriefResponse }) {
  return (
    <article className="rounded-xl border border-line bg-white p-3.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-black text-text">
          Débrief · {DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-faint">{formatDate(debrief.createdAt)}</span>
      </div>
      {debrief.notes && <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{debrief.notes}</p>}
      {debrief.objection && <p className="mt-1 text-[11px] font-semibold text-faint">Objection : {debrief.objection}</p>}
    </article>
  )
}
