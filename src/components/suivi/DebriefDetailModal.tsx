import { useEffect } from 'react'
import { formatDate } from '../../lib/suivi'
import {
  DEBRIEF_OUTCOME_LABEL,
  DEBRIEF_NON_SALE_REASON_LABEL,
  DEBRIEF_REFLEXION_REASON_LABEL,
  DEBRIEF_SUIVI_REASON_LABEL,
  PAYMENT_SUB_METHOD_LABEL,
  FINANCING_ORG_LABEL,
  type DebriefResponse,
} from '../../lib/types'

type Props = {
  debrief: DebriefResponse
  commercialName?: string
  onClose: () => void
}

const FINANCING_TYPE_SHORT: Record<string, string> = {
  comptant: 'Comptant',
  financement: 'Financement',
  financement_sans_apport: 'Financement sans apport',
  apport_financement: 'Apport + financement',
  paiement_10x: 'Paiement 10x',
  paiement_12x: 'Paiement 12x',
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="fiche-debrief-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Popup détaillant un débrief commercial (motifs, financement, notes…). */
export function DebriefDetailModal({ debrief, commercialName, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reason =
    debrief.nonSaleReason ? DEBRIEF_NON_SALE_REASON_LABEL[debrief.nonSaleReason]
    : debrief.reflexionReason ? DEBRIEF_REFLEXION_REASON_LABEL[debrief.reflexionReason]
    : debrief.suiviReason ? DEBRIEF_SUIVI_REASON_LABEL[debrief.suiviReason]
    : null

  const financing = debrief.financingType
    ? FINANCING_TYPE_SHORT[debrief.financingType] ?? debrief.financingType
    : null
  const acompte = debrief.acompteAmount != null
    ? `${Number(debrief.acompteAmount).toLocaleString('fr-FR')} €${debrief.acomptePercent != null ? ` (${debrief.acomptePercent} %)` : ''}`
    : null
  const montant = debrief.montantTotal != null
    ? `${Number(debrief.montantTotal).toLocaleString('fr-FR')} €`
    : null

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Détail du débrief" onClick={onClose}>
      <div className="fiche-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Débrief commercial</span>
            <h2>{DEBRIEF_OUTCOME_LABEL[debrief.outcome] ?? debrief.outcome}</h2>
            <p className="fiche-modal-sub">
              {formatDate(debrief.createdAt)}{commercialName ? ` · ${commercialName}` : ''}
            </p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          <dl className="fiche-debrief-grid">
            <Row label="Motif" value={reason} />
            <Row label="Montant total" value={montant} />
            <Row label="Financement" value={financing} />
            <Row label="Méthode de paiement" value={debrief.paymentSubMethod ? PAYMENT_SUB_METHOD_LABEL[debrief.paymentSubMethod] : null} />
            <Row label="Organisme" value={debrief.financingOrg ? FINANCING_ORG_LABEL[debrief.financingOrg] : null} />
            <Row label="Acompte" value={acompte} />
            <Row label="Kits" value={debrief.kits} />
            <Row label="Signé le" value={debrief.signedAt ? formatDate(debrief.signedAt) : null} />
          </dl>

          {debrief.acceptanceFactors.length > 0 && (
            <section className="fiche-modal-section">
              <h3>Facteurs d'acceptation</h3>
              <div className="fiche-chip-list">
                {debrief.acceptanceFactors.map((f) => (
                  <span key={f} className="fiche-chip">{f}</span>
                ))}
              </div>
            </section>
          )}

          {debrief.objection && (
            <section className="fiche-modal-section">
              <h3>Objection</h3>
              <p className="fiche-modal-text">{debrief.objection}</p>
            </section>
          )}

          {debrief.notes && (
            <section className="fiche-modal-section">
              <h3>Notes</h3>
              <p className="fiche-modal-text whitespace-pre-wrap">{debrief.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
