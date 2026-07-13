import { useState } from 'react'
import { recordEcheance } from '../../lib/api'
import { todayIso } from '../../lib/suivi-board'
import { formatDate } from '../../lib/suivi'
import type { AcompteResponse, AcompteStatut, EcheanceLine } from '../../lib/types'

function money(v: string | null): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isNaN(n) ? '—' : `${n.toLocaleString('fr-FR')} €`
}

/**
 * Modal pour enregistrer (ou modifier) l'encaissement d'une tranche d'échéancier.
 * Partagé entre Finances.tsx et ProjectDetail.tsx.
 */
export function RecordEcheanceModal({
  acompte,
  tranche,
  onClose,
  onSaved,
}: {
  acompte: AcompteResponse
  tranche: EcheanceLine
  onClose: () => void
  onSaved: () => void
}) {
  const [statut, setStatut] = useState<AcompteStatut>(
    tranche.statut === 'encaisse' || tranche.statut === 'annule' ? tranche.statut : 'encaisse',
  )
  const [montantReel, setMontantReel] = useState(tranche.montantReel ?? tranche.montantPrevu ?? '')
  const [date, setDate] = useState(tranche.dateEncaissement ?? todayIso())
  const [dateEcheance, setDateEcheance] = useState(tranche.dateEcheance ?? '')
  const [notes, setNotes] = useState(tranche.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEncaisse = statut === 'encaisse'

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await recordEcheance(acompte.debriefId, {
        ordre: tranche.ordre,
        statut,
        montantReel: isEncaisse ? (montantReel || null) : null,
        dateEcheance: dateEcheance || null,
        dateEncaissement: isEncaisse ? (date || null) : null,
        notes: notes || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Enregistrer la tranche" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Acompte · tranche {tranche.ordre}</span>
            <h2>{acompte.clientName ?? 'Client'}</h2>
            <p className="fiche-modal-sub">
              {tranche.label}
              {tranche.percent != null ? ` · ${tranche.percent}%` : ''} · prévu {money(tranche.montantPrevu)}
            </p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          <section className="wf-modal-section">
            <h3>Statut</h3>
            <select className="wf-modal-input" value={statut} onChange={(e) => setStatut(e.target.value as AcompteStatut)}>
              <option value="encaisse">Encaissé</option>
              <option value="a_encaisser">À encaisser</option>
              <option value="en_attente">En attente</option>
              <option value="en_retard">En retard</option>
              <option value="annule">Annulé</option>
            </select>
          </section>

          <section className="wf-modal-section">
            <h3>Date prévue d'encaissement (échéance)</h3>
            <input className="wf-modal-input" type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
            <p className="text-xs text-faint mt-1">Si dépassée et non encaissée, la tranche passe automatiquement « en retard ».</p>
          </section>

          {isEncaisse && (
            <>
              <section className="wf-modal-section">
                <h3>Montant réel encaissé</h3>
                <input
                  className="wf-modal-input"
                  inputMode="decimal"
                  value={montantReel}
                  onChange={(e) => setMontantReel(e.target.value)}
                  placeholder="ex : 3000"
                />
              </section>
              <section className="wf-modal-section">
                <h3>Date d'encaissement</h3>
                <input className="wf-modal-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </section>
            </>
          )}

          <section className="wf-modal-section">
            <h3>Notes</h3>
            <textarea
              className="wf-modal-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Référence virement, remarque…"
            />
          </section>

          {error && <p className="wf-modal-error">{error}</p>}
        </div>

        <footer className="wf-modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export { formatDate, money }
