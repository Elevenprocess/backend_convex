// Modale « Donner ce client à un commercial » — réservée au responsable
// commercial / admin (la garde RBAC est aussi posée côté backend sur
// POST /leads/:id/assign). Transfère la propriété du lead + ses RDV à venir.
import { useState } from 'react'
import { Icon } from '../Icon'
import { Spinner } from '../Spinner'
import { assignLead } from '../../lib/hooks'
import { ApiError } from '../../lib/api'
import { fullName, type LeadResponse, type UserResponse } from '../../lib/types'

export function AssignCommercialModal({
  lead,
  commerciaux,
  onClose,
  onAssigned,
}: {
  lead: LeadResponse
  commerciaux: UserResponse[]
  onClose: () => void
  onAssigned?: (updated: LeadResponse) => void
}) {
  const [selected, setSelected] = useState<string | null>(lead.assignedToId ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unchanged = selected === (lead.assignedToId ?? null)

  async function submit() {
    if (!selected || unchanged) return
    setError(null)
    setSubmitting(true)
    try {
      const updated = await assignLead(lead.id, selected)
      onAssigned?.(updated)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Échec de l'attribution.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-noir/50 backdrop-blur-sm px-4"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="glass-card w-full max-w-md max-h-[92vh] flex flex-col p-0 shadow-2xl">
        <div className="px-6 py-4 border-b border-line">
          <div className="eyebrow text-or-dark">Attribution</div>
          <h3 className="text-xl font-black mt-1">Donner ce client à un commercial</h3>
          <p className="text-xs text-muted mt-1">
            {fullName(lead)} sera transféré au commercial choisi. Ses RDV à venir le suivent automatiquement.
          </p>
        </div>

        <div className="px-6 py-4 space-y-2 overflow-y-auto">
          {commerciaux.length === 0 ? (
            <p className="text-sm text-faint py-6 text-center">Aucun commercial actif disponible.</p>
          ) : (
            commerciaux.map((c) => {
              const isCurrent = c.id === lead.assignedToId
              const isSelected = c.id === selected
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left rounded-2xl border px-4 py-3 text-sm transition flex items-center justify-between gap-2 ${
                    isSelected ? 'border-or bg-or/10' : 'border-line bg-white/70 hover:bg-white hover:border-or'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-or-tint flex items-center justify-center text-[10px] font-bold shrink-0">
                      {chipInitials(c.name)}
                    </span>
                    <span className="font-semibold truncate">{c.name}</span>
                    {isCurrent && (
                      <span className="shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-cuivre-tint text-cuivre">
                        Actuel
                      </span>
                    )}
                  </span>
                  {isSelected && <Icon name="check" size={16} className="text-or-dark shrink-0" />}
                </button>
              )
            })
          )}

          {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-muted hover:text-text disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !selected || unchanged}
            className="btn-primary px-5 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting && <Spinner size={14} />}
            {submitting ? 'Attribution…' : 'Donner le client'}
          </button>
        </div>
      </div>
    </div>
  )
}

function chipInitials(name: string): string {
  const parts = name.split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
}
