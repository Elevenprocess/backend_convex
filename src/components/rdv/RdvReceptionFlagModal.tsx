import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { flagRdvByReception } from '../../lib/hooks'

type Kind = 'annule' | 'reporte'

/**
 * Modale « Signaler annulation / report » utilisée par l'accueil quand un
 * prospect prévient sur le numéro central (appel / WhatsApp). Met à jour le RDV
 * et déclenche l'alerte au commercial concerné (notification + push).
 */
export function RdvReceptionFlagModal({
  rdvId,
  leadName,
  commercialName,
  onClose,
  onDone,
}: {
  rdvId: string
  leadName: string
  commercialName: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [kind, setKind] = useState<Kind>('annule')
  const [reason, setReason] = useState('')
  const [newDate, setNewDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await flagRdvByReception(rdvId, {
        kind,
        reason,
        newScheduledAt: kind === 'reporte' && newDate ? newDate : undefined,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec du signalement.')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-stretch justify-center bg-[rgba(12, 27, 36,0.58)] p-0 backdrop-blur-sm sm:items-center sm:p-7"
      role="dialog"
      aria-modal="true"
      aria-label="Signaler une annulation ou un report"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-cream-darker shadow-2xl sm:h-auto sm:max-h-[88vh] sm:w-[min(520px,94vw)] sm:rounded-2xl sm:border sm:border-line"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'fiche-wf-fade .16s ease' }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rouille-tint text-rouille">
              <Icon name="bell" size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black leading-tight text-text">Signaler annulation / report</h2>
              <p className="truncate text-[11px] leading-tight text-muted">
                {leadName}{commercialName ? ` · commercial : ${commercialName}` : ' · aucun commercial assigné'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-muted transition hover:border-rouille/40 hover:bg-rouille-tint hover:text-rouille"
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {/* Type : annulation vs report */}
          <div>
            <span className="eyebrow mb-1.5 block">Type de signalement</span>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'annule' as const, label: 'Annulation', icon: 'x' as const },
                { id: 'reporte' as const, label: 'Report', icon: 'calendar' as const },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setKind(opt.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                    kind === opt.id
                      ? 'border-or bg-or-tint text-or-dark'
                      : 'border-line bg-card text-muted hover:bg-cream'
                  }`}
                >
                  <Icon name={opt.icon} size={15} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Nouvelle date (report uniquement) */}
          {kind === 'reporte' && (
            <div>
              <span className="eyebrow mb-1.5 block">Nouvelle date proposée (optionnel)</span>
              <input
                type="datetime-local"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-text outline-none transition focus:border-or"
              />
              <p className="mt-1 text-[11px] text-faint">
                Sans date, le RDV passe en « Reporté » à replanifier.
              </p>
            </div>
          )}

          {/* Motif */}
          <div>
            <span className="eyebrow mb-1.5 block">Motif / message du prospect (optionnel)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ex. indisponible, empêchement, souhaite un autre créneau…"
              className="w-full min-h-[84px] resize-none rounded-xl border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-text outline-none transition placeholder:text-faint focus:border-or"
            />
          </div>

          {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs font-semibold text-rouille">{error}</div>}
        </div>

        <footer
          className="flex items-center justify-end gap-2 border-t border-line bg-card px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            className="rounded-xl border border-line bg-card px-4 py-2 text-sm font-semibold text-muted transition hover:bg-cream"
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
            onClick={submit}
            disabled={saving}
          >
            {saving ? 'Envoi…' : 'Prévenir le commercial'}
          </button>
        </footer>
      </div>
    </div>
  )
}
