import { useEffect, useMemo, useState } from 'react'
import { upsertCommercialObjective } from '../../lib/api'
import type { CommercialObjectiveResponse, UpsertCommercialObjectivePayload } from '../../lib/types'

type Commercial = { id: string; name: string; initials: string }

type Props = {
  commercials: Commercial[]
  objectives: Map<string, CommercialObjectiveResponse>
  period: string
  periodLabel: string
  onClose: () => void
  onSaved: () => void
}

type Draft = { caTarget: string; ventesTarget: string; rdvTarget: string; closingTarget: string }

function toDraft(o: CommercialObjectiveResponse | undefined): Draft {
  return {
    caTarget: o?.caTarget != null ? String(o.caTarget) : '',
    ventesTarget: o?.ventesTarget != null ? String(o.ventesTarget) : '',
    rdvTarget: o?.rdvTarget != null ? String(o.rdvTarget) : '',
    closingTarget: o?.closingTarget != null ? String(o.closingTarget) : '',
  }
}
const numOrNull = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const sameDraft = (a: Draft, b: Draft) =>
  a.caTarget === b.caTarget && a.ventesTarget === b.ventesTarget && a.rdvTarget === b.rdvTarget && a.closingTarget === b.closingTarget

/** Modal : fixe les objectifs du mois (CA, ventes, RDV, closing) par commercial. */
export function ObjectivesEditorModal({ commercials, objectives, period, periodLabel, onClose, onSaved }: Props) {
  const initial = useMemo(() => {
    const m: Record<string, Draft> = {}
    for (const c of commercials) m[c.id] = toDraft(objectives.get(c.id))
    return m
  }, [commercials, objectives])

  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setField = (id: string, field: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }))

  const dirtyIds = commercials.filter((c) => !sameDraft(drafts[c.id], initial[c.id])).map((c) => c.id)

  const onSave = async () => {
    if (dirtyIds.length === 0) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      await Promise.all(
        dirtyIds.map((id) => {
          const d = drafts[id]
          const payload: UpsertCommercialObjectivePayload = {
            commercialId: id,
            period,
            caTarget: numOrNull(d.caTarget),
            ventesTarget: numOrNull(d.ventesTarget),
            rdvTarget: numOrNull(d.rdvTarget),
            closingTarget: numOrNull(d.closingTarget),
          }
          return upsertCommercialObjective(payload)
        }),
      )
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’enregistrement des objectifs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="obj-modal-backdrop" role="dialog" aria-modal="true" aria-label="Objectifs de l'équipe" onClick={onClose}>
      <div className="obj-modal" onClick={(e) => e.stopPropagation()}>
        <header className="obj-modal-head">
          <div>
            <span className="shot-eyebrow">Objectifs · {periodLabel}</span>
            <h2>Définir les objectifs de l'équipe</h2>
          </div>
          <button type="button" className="obj-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="obj-modal-body">
          <div className="obj-grid obj-grid-head">
            <span>Commercial</span>
            <span>CA (€)</span>
            <span>Ventes</span>
            <span>RDV</span>
            <span>Closing %</span>
          </div>
          {commercials.length === 0 ? (
            <p className="obj-empty">Aucun commercial à configurer.</p>
          ) : commercials.map((c) => {
            const d = drafts[c.id]
            return (
              <div key={c.id} className="obj-grid obj-row">
                <span className="obj-name"><span className="obj-avatar">{c.initials}</span>{c.name}</span>
                <input type="number" min={0} inputMode="numeric" value={d.caTarget} onChange={(e) => setField(c.id, 'caTarget', e.target.value)} placeholder="—" />
                <input type="number" min={0} inputMode="numeric" value={d.ventesTarget} onChange={(e) => setField(c.id, 'ventesTarget', e.target.value)} placeholder="—" />
                <input type="number" min={0} inputMode="numeric" value={d.rdvTarget} onChange={(e) => setField(c.id, 'rdvTarget', e.target.value)} placeholder="—" />
                <input type="number" min={0} max={100} inputMode="numeric" value={d.closingTarget} onChange={(e) => setField(c.id, 'closingTarget', e.target.value)} placeholder="—" />
              </div>
            )
          })}
        </div>

        <footer className="obj-modal-foot">
          {error && <span className="obj-error">{error}</span>}
          <span className="obj-dirty">{dirtyIds.length > 0 ? `${dirtyIds.length} modifié${dirtyIds.length > 1 ? 's' : ''}` : 'Aucune modification'}</span>
          <button type="button" className="obj-btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="obj-btn-primary" onClick={onSave} disabled={saving || dirtyIds.length === 0}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </footer>
      </div>
    </div>
  )
}
