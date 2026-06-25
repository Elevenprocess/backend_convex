import { useState } from 'react'
import { setEcheancier, resetEcheancier } from '../../lib/api'
import type { AcompteResponse, EcheancierTranchePatch } from '../../lib/types'

function money(v: string | null): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isNaN(n) ? '—' : `${n.toLocaleString('fr-FR')} €`
}

type EditTranche = { label: string; percent: string; dateEcheance: string; jalonKey: string | null }

/**
 * Éditeur d'échéancier personnalisé : le back-office définit librement le nombre
 * de tranches, leur libellé, leur % et leur date d'échéance. Préremplit depuis
 * l'échéancier courant. Affiche le total des % et le reste à répartir.
 * Partagé entre Finances.tsx et ProjectDetail.tsx.
 */
export function EcheancierEditorModal({
  acompte: a, onClose, onSaved,
}: { acompte: AcompteResponse; onClose: () => void; onSaved: () => void }) {
  const [tranches, setTranches] = useState<EditTranche[]>(() =>
    a.echeances.map((e) => ({
      label: e.label ?? '',
      percent: e.percent != null ? String(e.percent) : '',
      dateEcheance: e.dateEcheance ?? '',
      jalonKey: e.jalonKey,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = Number(a.montantTotal ?? 0) || 0
  const sumPercent = tranches.reduce((s, t) => s + (Number(t.percent) || 0), 0)
  const reste = 100 - sumPercent

  const setRow = (i: number, patch: Partial<EditTranche>) =>
    setTranches((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () => setTranches((rows) => [...rows, { label: '', percent: '', dateEcheance: '', jalonKey: null }])
  const removeRow = (i: number) => setTranches((rows) => rows.filter((_, idx) => idx !== i))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: EcheancierTranchePatch[] = tranches.map((t) => ({
        label: t.label.trim() || null,
        percent: t.percent.trim() ? Number(t.percent) : null,
        montantPrevu: null,
        jalonKey: t.jalonKey,
        dateEcheance: t.dateEcheance || null,
      }))
      await setEcheancier(a.debriefId, payload)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  const revert = async () => {
    if (!window.confirm("Revenir à l'échéancier standard ? Les tranches personnalisées seront ignorées.")) return
    setSaving(true)
    setError(null)
    try {
      await resetEcheancier(a.debriefId)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Personnaliser l'échéancier" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Échéancier personnalisé</span>
            <h2>{a.projectName ?? a.clientName ?? 'Projet'}</h2>
            <p className="fiche-modal-sub">
              Montant total {money(a.montantTotal)} · total réparti {sumPercent}%
              {reste !== 0 && <span className={reste < 0 ? 'text-rouille' : 'text-faint'}> · reste {reste}%</span>}
            </p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          {tranches.map((t, i) => (
            <div key={i} className="flex items-end gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">Libellé</label>
                <input className="wf-modal-input" value={t.label} placeholder={`Tranche ${i + 1}`}
                  onChange={(e) => setRow(i, { label: e.target.value })} />
              </div>
              <div style={{ width: 72 }}>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">%</label>
                <input className="wf-modal-input" inputMode="numeric" value={t.percent}
                  onChange={(e) => setRow(i, { percent: e.target.value })} />
              </div>
              <div style={{ width: 96 }}>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">Montant</label>
                <div className="text-sm font-semibold pt-2">{total && Number(t.percent) ? `${Math.round(total * Number(t.percent) / 100).toLocaleString('fr-FR')} €` : '—'}</div>
              </div>
              <div style={{ width: 150 }}>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">Échéance</label>
                <input className="wf-modal-input" type="date" value={t.dateEcheance}
                  onChange={(e) => setRow(i, { dateEcheance: e.target.value })} />
              </div>
              <button type="button" className="fin-action text-rouille mb-1" title="Supprimer la tranche"
                onClick={() => removeRow(i)} disabled={tranches.length <= 1}>✕</button>
            </div>
          ))}

          <button type="button" className="fin-action mt-1" onClick={addRow}>+ Ajouter une tranche</button>

          {sumPercent !== 100 && (
            <p className="text-xs text-rouille mt-3">⚠ Le total des pourcentages est de {sumPercent}% (attendu : 100%).</p>
          )}
          {error && <p className="wf-modal-error mt-2">{error}</p>}
        </div>

        <footer className="wf-modal-foot">
          {a.customEcheancier && (
            <button type="button" className="btn-ghost mr-auto" onClick={() => void revert()} disabled={saving}>
              Revenir au standard
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : "Enregistrer l’échéancier"}
          </button>
        </footer>
      </div>
    </div>
  )
}
