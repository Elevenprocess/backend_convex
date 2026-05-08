import { useState, useEffect } from 'react'
import { Icon } from '../../components/Icon'
import { fullName, type LeadResponse, type RdvResponse } from '../../lib/types'

type Outcome = 'vente' | 'relancer' | 'perdu'

type DebriefModalProps = {
  rdv: RdvResponse
  lead: LeadResponse
  onClose: () => void
  onSave: () => void
}

export function DebriefModal({ rdv, lead, onClose, onSave }: DebriefModalProps) {
  const [outcome, setOutcome] = useState<Outcome>('vente')
  const [paymentMode, setPaymentMode] = useState('Comptant')
  const [amount, setAmount] = useState('')
  const [signDate, setSignDate] = useState(formatDateInput(rdv.scheduledAt))
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(42, 37, 32, 0.4)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[24px] w-[640px] max-w-[90vw] max-h-[90vh] overflow-y-auto p-8 shadow-[0_30px_80px_rgba(0,0,0,0.2)] border border-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <span className="eyebrow block">DÉBRIEF RDV</span>
            <h2 className="text-[24px] font-bold">{fullName(lead)} — {formatDateShort(rdv.scheduledAt)}</h2>
          </div>
          <button onClick={onClose} className="text-faint hover:text-text">
            <Icon name="x" size={22} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Outcome */}
          <div>
            <span className="eyebrow block mb-2">RÉSULTAT</span>
            <div className="grid grid-cols-3 gap-2">
              <OutcomeButton active={outcome === 'vente'} onClick={() => setOutcome('vente')} variant="success">Vente</OutcomeButton>
              <OutcomeButton active={outcome === 'relancer'} onClick={() => setOutcome('relancer')} variant="cuivre">À relancer</OutcomeButton>
              <OutcomeButton active={outcome === 'perdu'} onClick={() => setOutcome('perdu')} variant="rouille">Perdu</OutcomeButton>
            </div>
          </div>

          {/* Vente fields */}
          {outcome === 'vente' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="eyebrow block mb-2">MODE PAIEMENT</span>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                    className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full"
                  >
                    <option>Comptant</option>
                    <option>Financement</option>
                    <option>Subvention</option>
                  </select>
                </div>
                <div>
                  <span className="eyebrow block mb-2">MONTANT (€)</span>
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full"
                  />
                </div>
              </div>
              <div>
                <span className="eyebrow block mb-2">DATE SIGNATURE</span>
                <input
                  type="text"
                  value={signDate}
                  onChange={(e) => setSignDate(e.target.value)}
                  className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full"
                />
              </div>
            </>
          )}

          {/* À relancer fields */}
          {outcome === 'relancer' && (
            <div>
              <span className="eyebrow block mb-2">DATE DE RELANCE</span>
              <input
                type="text"
                placeholder="dd/mm/yyyy"
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full"
              />
            </div>
          )}

          {/* Notes (always) */}
          <div>
            <span className="eyebrow block mb-2">NOTES DE CLOSING</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Décris l'issue du RDV…"
              className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
            />
          </div>

          <p className="text-xs text-faint">
            Note : l'enregistrement de débrief sera connecté quand le endpoint <code className="bg-cream px-1.5 py-0.5 rounded">PATCH /rdv/:id</code> sera dispo.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary px-5 py-3 rounded-[14px] flex-grow">Annuler</button>
            <button onClick={onSave} className="btn-primary px-5 py-3 rounded-[14px] flex-grow">Enregistrer le débrief</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function OutcomeButton({
  active, onClick, variant, children,
}: {
  active: boolean
  onClick: () => void
  variant: 'success' | 'cuivre' | 'rouille'
  children: React.ReactNode
}) {
  const activeClass =
    variant === 'success' ? 'bg-success-tint text-success border-success/30' :
    variant === 'cuivre' ? 'bg-cuivre-tint text-cuivre border-cuivre/30' :
    'bg-rouille-tint text-rouille border-rouille/30'

  return (
    <button
      onClick={onClick}
      className={`px-3 py-3 rounded-[14px] font-semibold text-sm border transition-colors ${
        active ? activeClass : 'bg-white border-line text-muted hover:bg-cream'
      }`}
    >
      {children}
    </button>
  )
}

function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function formatDateInput(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
}
