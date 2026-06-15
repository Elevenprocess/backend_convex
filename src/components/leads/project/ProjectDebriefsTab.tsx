import { useState } from 'react'
import { Icon } from '../../Icon'
import { Spinner } from '../../Spinner'
import { ApiError, createDebrief, createLeadDebrief, deleteDebrief } from '../../../lib/api'
import {
  DEBRIEF_ACCEPTANCE_FACTOR_LABEL,
  DEBRIEF_NON_SALE_REASON_LABEL,
  DEBRIEF_OUTCOME_LABEL,
  DEBRIEF_REFLEXION_REASON_LABEL,
  DEBRIEF_SUIVI_REASON_LABEL,
  type DebriefAcceptanceFactor,
  type DebriefOutcome,
  type DebriefResponse,
  type LeadResponse,
  type ProjectResponse,
} from '../../../lib/types'
import {
  DebriefFormFields,
  EMPTY_DEBRIEF_FORM,
  isDebriefFormValid,
  type DebriefFormValue,
} from './DebriefFormFields'
import { CommercialDebriefSidebar } from '../CommercialDebriefSidebar'
import { useAuth } from '../../../lib/auth'

// Côté commercial, le débrief projet réutilise le wizard multi-étapes commun
// (même expérience que depuis la fiche / la navigation) plutôt que le formulaire
// inline simplifié réservé à l'admin.
const WIZARD_DEBRIEF_ROLES = ['commercial', 'commercial_lead']

type Props = {
  project: ProjectResponse
  lead: LeadResponse
  debriefs: DebriefResponse[]
  onChanged: () => void
  // Optionnel : remonté par ProjectDetailView pour ouvrir le débrief RDV.
  // Déclaré ici pour satisfaire le type passé par le parent (câblage préexistant).
  onRdvDebrief?: () => void
}

const OUTCOME_TONE: Record<DebriefOutcome, { bg: string; text: string; icon: 'trophy' | 'edit' | 'phone' | 'x' }> = {
  vente: { bg: 'bg-success-tint', text: 'text-success', icon: 'trophy' },
  en_reflexion: { bg: 'bg-info-tint', text: 'text-info', icon: 'edit' },
  suivi_prevu: { bg: 'bg-or-tint', text: 'text-or-dark', icon: 'phone' },
  non_vente: { bg: 'bg-rouille-tint', text: 'text-rouille', icon: 'x' },
}

export function ProjectDebriefsTab({ project, lead, debriefs, onChanged }: Props) {
  const role = useAuth((s) => s.user?.role)
  const useWizard = !!role && WIZARD_DEBRIEF_ROLES.includes(role)
  const [adding, setAdding] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [form, setForm] = useState<DebriefFormValue>(EMPTY_DEBRIEF_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setForm(EMPTY_DEBRIEF_FORM)
    setAdding(false)
    setError(null)
  }

  async function submit() {
    setError(null)
    if (!isDebriefFormValid(form)) {
      setError('Sélectionne un résultat et son motif.')
      return
    }
    setSaving(true)
    try {
      await createDebrief(project.id, {
        outcome: form.outcome as DebriefOutcome,
        nonSaleReason: form.nonSaleReason || null,
        reflexionReason: form.reflexionReason || null,
        suiviReason: form.suiviReason || null,
        objection: form.objection.trim() || null,
        acceptanceFactors: form.acceptanceFactors,
        notes: form.notes.trim() || null,
        montantTotal: form.montantTotal.trim() || null,
        financingType: form.financingType || null,
        signedAt: form.signedAt || null,
        kits: form.kits.trim() || null,
      })
      reset()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Sauvegarde échouée.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer ce débrief ?')) return
    try {
      await deleteDebrief(id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suppression échouée.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => (useWizard ? setWizardOpen(true) : setAdding(true))}
          disabled={adding || wizardOpen}
          className="btn-primary w-full px-4 py-2.5 rounded-2xl text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Icon name="plus" size={14} />
          Ajouter un débrief
        </button>
      </div>

      {useWizard && wizardOpen && (
        <>
          <button
            type="button"
            aria-label="Fermer le débriefing"
            onClick={() => setWizardOpen(false)}
            className="fixed inset-0 z-[135] bg-text/40 backdrop-blur-sm md:hidden"
          />
          <CommercialDebriefSidebar
            lead={lead}
            forceFreeDebrief
            onClose={() => setWizardOpen(false)}
            onSubmitFromFiche={(payload) => {
              // Débrief rattaché directement à CE projet (pas de résolution lead-level).
              void createLeadDebrief(lead.id, { ...payload, projectId: project.id })
                .then(() => onChanged())
                .catch(() => onChanged())
            }}
            className="fixed top-0 right-0 bottom-0 z-[140]"
          />
        </>
      )}

      {!useWizard && adding && (
        <div className="rounded-2xl border-2 border-or bg-white p-4 space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="eyebrow text-or-dark text-[10px]">Nouveau débrief</div>
            <button
              type="button"
              onClick={reset}
              disabled={saving}
              className="text-muted hover:text-text"
              title="Annuler"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          <DebriefFormFields value={form} onChange={setForm} />

          {error && <div className="rounded-xl bg-rouille-tint px-3 py-2 text-xs text-rouille">{error}</div>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted hover:text-text disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !isDebriefFormValid(form)}
              className="btn-primary px-4 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 disabled:opacity-60"
            >
              {saving && <Spinner size={12} />}
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {debriefs.length === 0 && !adding ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/40 px-4 py-4 text-xs text-muted">
          Aucun débrief pour ce projet. Ajoute-en un après chaque échange commercial.
        </div>
      ) : (
        <ul className="space-y-2">
          {debriefs.map((d) => <DebriefRow key={d.id} debrief={d} onDelete={() => void handleDelete(d.id)} />)}
        </ul>
      )}
    </div>
  )
}

export function DebriefRow({ debrief, onDelete, projectName }: { debrief: DebriefResponse; onDelete: () => void; projectName?: string }) {
  const tone = OUTCOME_TONE[debrief.outcome]
  const motifLabel = motifLabelFor(debrief)
  return (
    <li className={`rounded-2xl border ${tone.bg.replace('bg-', 'border-')}/50 bg-white/80 px-4 py-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 w-7 h-7 rounded-lg ${tone.bg} flex items-center justify-center`}>
            <Icon name={tone.icon} size={14} className={tone.text} />
          </div>
          <div className="min-w-0">
            <div className={`font-bold text-sm ${tone.text}`}>{DEBRIEF_OUTCOME_LABEL[debrief.outcome]}</div>
            <div className="text-[11px] text-muted mt-0.5">
              {new Date(debrief.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              {debrief.rdvId && <> · lié à un RDV</>}
              {projectName && <> · {projectName}</>}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="text-faint hover:text-rouille"
          title="Supprimer"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {motifLabel && (
        <div className="mt-2 text-[11px]">
          <span className="font-bold">Motif :</span> {motifLabel}
        </div>
      )}
      {debrief.outcome === 'vente' && debrief.acceptanceFactors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(debrief.acceptanceFactors as DebriefAcceptanceFactor[]).map((f) => (
            <span key={f} className="text-[10px] font-bold bg-success-tint text-success px-2 py-0.5 rounded-full">
              {DEBRIEF_ACCEPTANCE_FACTOR_LABEL[f] ?? f}
            </span>
          ))}
        </div>
      )}
      {debrief.objection && (
        <div className="mt-1 text-[11px] text-cuivre">
          <span className="font-bold">Objection :</span> {debrief.objection}
        </div>
      )}
      {debrief.montantTotal && (
        <div className="mt-1 text-[11px] text-success">
          <span className="font-bold">Montant :</span> {Number(debrief.montantTotal).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
        </div>
      )}
      {debrief.notes && <div className="mt-2 text-[12px] text-text whitespace-pre-wrap">{debrief.notes}</div>}
    </li>
  )
}

function motifLabelFor(d: DebriefResponse): string | null {
  if (d.outcome === 'non_vente' && d.nonSaleReason) return DEBRIEF_NON_SALE_REASON_LABEL[d.nonSaleReason]
  if (d.outcome === 'en_reflexion' && d.reflexionReason) return DEBRIEF_REFLEXION_REASON_LABEL[d.reflexionReason]
  if (d.outcome === 'suivi_prevu' && d.suiviReason) return DEBRIEF_SUIVI_REASON_LABEL[d.suiviReason]
  return null
}
