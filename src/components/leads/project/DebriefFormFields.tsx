import { Icon, type IconName } from '../../Icon'
import {
  DEBRIEF_ACCEPTANCE_FACTOR_LABEL,
  DEBRIEF_NON_SALE_REASON_LABEL,
  DEBRIEF_OUTCOME_LABEL,
  DEBRIEF_REFLEXION_REASON_LABEL,
  DEBRIEF_SUIVI_REASON_LABEL,
  type DebriefAcceptanceFactor,
  type DebriefNonSaleReason,
  type DebriefOutcome,
  type DebriefReflexionReason,
  type DebriefSuiviReason,
  type FinancingType,
} from '../../../lib/types'

export type DebriefFormValue = {
  outcome: DebriefOutcome | ''
  nonSaleReason: DebriefNonSaleReason | ''
  reflexionReason: DebriefReflexionReason | ''
  suiviReason: DebriefSuiviReason | ''
  acceptanceFactors: DebriefAcceptanceFactor[]
  objection: string
  notes: string
  montantTotal: string
  financingType: FinancingType | ''
  signedAt: string
  kits: string
}

export const EMPTY_DEBRIEF_FORM: DebriefFormValue = {
  outcome: '',
  nonSaleReason: '',
  reflexionReason: '',
  suiviReason: '',
  acceptanceFactors: [],
  objection: '',
  notes: '',
  montantTotal: '',
  financingType: '',
  signedAt: '',
  kits: '',
}

const OUTCOMES: { value: DebriefOutcome; icon: IconName; tone: 'success' | 'rouille' | 'or' | 'info' }[] = [
  { value: 'vente', icon: 'trophy', tone: 'success' },
  { value: 'non_vente', icon: 'x', tone: 'rouille' },
]

const FINANCING: { value: FinancingType; label: string }[] = [
  { value: 'comptant', label: 'Comptant' },
  { value: 'financement', label: 'Financement' },
  { value: 'paiement_10x', label: 'Paiement 10x' },
]

const NON_SALE_REASONS = Object.keys(DEBRIEF_NON_SALE_REASON_LABEL) as DebriefNonSaleReason[]
const REFLEXION_REASONS = Object.keys(DEBRIEF_REFLEXION_REASON_LABEL) as DebriefReflexionReason[]
const SUIVI_REASONS = Object.keys(DEBRIEF_SUIVI_REASON_LABEL) as DebriefSuiviReason[]
const ACCEPTANCE_FACTORS = Object.keys(DEBRIEF_ACCEPTANCE_FACTOR_LABEL) as DebriefAcceptanceFactor[]

export function applyOutcomeChange(form: DebriefFormValue, outcome: DebriefOutcome): DebriefFormValue {
  // Reset les motifs et champs vente quand on change d'outcome.
  return {
    ...form,
    outcome,
    nonSaleReason: '',
    reflexionReason: '',
    suiviReason: '',
    acceptanceFactors: outcome === 'vente' ? form.acceptanceFactors : [],
    montantTotal: outcome === 'vente' ? form.montantTotal : '',
    financingType: outcome === 'vente' ? form.financingType : '',
    signedAt: outcome === 'vente' ? form.signedAt : '',
    kits: outcome === 'vente' ? form.kits : '',
  }
}

export function isDebriefFormValid(form: DebriefFormValue): boolean {
  if (form.outcome === '') return false
  if (form.outcome === 'vente') return true
  if (form.outcome === 'non_vente') return form.nonSaleReason !== ''
  if (form.outcome === 'en_reflexion') return form.reflexionReason !== ''
  if (form.outcome === 'suivi_prevu') return form.suiviReason !== ''
  return false
}

type Props = {
  value: DebriefFormValue
  onChange: (next: DebriefFormValue) => void
}

export function DebriefFormFields({ value, onChange }: Props) {
  function update(patch: Partial<DebriefFormValue>) {
    onChange({ ...value, ...patch })
  }

  function setOutcome(o: DebriefOutcome) {
    onChange(applyOutcomeChange(value, o))
  }

  function toggleFactor(f: DebriefAcceptanceFactor) {
    const has = value.acceptanceFactors.includes(f)
    update({
      acceptanceFactors: has
        ? value.acceptanceFactors.filter((x) => x !== f)
        : [...value.acceptanceFactors, f],
    })
  }

  return (
    <div className="space-y-4">
      {/* Outcome — gros sélecteur visuel */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-2">Résultat</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {OUTCOMES.map((o) => {
            const selected = value.outcome === o.value
            const toneClasses = TONE_CLASSES[o.tone]
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                className={`relative rounded-2xl border-2 px-3 py-3 text-left transition-all ${
                  selected ? toneClasses.selected : `border-line bg-white/60 hover:${toneClasses.hoverBg}`
                }`}
              >
                <div className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${toneClasses.iconBg}`}>
                  <Icon name={o.icon} size={14} className={toneClasses.iconColor} />
                </div>
                <div className="mt-2 font-black text-[12px]">{DEBRIEF_OUTCOME_LABEL[o.value]}</div>
                <div className="text-[10px] text-muted mt-0.5">{OUTCOME_HINT[o.value]}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Motifs selon outcome */}
      {value.outcome === 'non_vente' && (
        <MotifSelector
          label="Raison non-vente"
          tone="rouille"
          options={NON_SALE_REASONS.map((r) => ({ value: r, label: DEBRIEF_NON_SALE_REASON_LABEL[r] }))}
          selected={value.nonSaleReason}
          onSelect={(v) => update({ nonSaleReason: v as DebriefNonSaleReason })}
        />
      )}
      {value.outcome === 'en_reflexion' && (
        <MotifSelector
          label="Motif de réflexion"
          tone="info"
          options={REFLEXION_REASONS.map((r) => ({ value: r, label: DEBRIEF_REFLEXION_REASON_LABEL[r] }))}
          selected={value.reflexionReason}
          onSelect={(v) => update({ reflexionReason: v as DebriefReflexionReason })}
        />
      )}
      {value.outcome === 'suivi_prevu' && (
        <MotifSelector
          label="Motif du suivi"
          tone="or"
          options={SUIVI_REASONS.map((r) => ({ value: r, label: DEBRIEF_SUIVI_REASON_LABEL[r] }))}
          selected={value.suiviReason}
          onSelect={(v) => update({ suiviReason: v as DebriefSuiviReason })}
        />
      )}
      {value.outcome === 'vente' && (
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-2">
            Facteurs d'acceptation <span className="text-faint normal-case font-semibold">(multi-sélection)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ACCEPTANCE_FACTORS.map((f) => {
              const sel = value.acceptanceFactors.includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFactor(f)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                    sel ? 'border-success bg-success-tint text-success' : 'border-line bg-white text-muted hover:text-text'
                  }`}
                >
                  {DEBRIEF_ACCEPTANCE_FACTOR_LABEL[f]}
                  {sel && <Icon name="check" size={10} className="inline ml-1" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Champs vente */}
      {value.outcome === 'vente' && (
        <div className="rounded-2xl border border-success/20 bg-success-tint/30 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Montant TTC (€)</label>
              <input
                type="text"
                inputMode="decimal"
                value={value.montantTotal}
                onChange={(e) => update({ montantTotal: e.target.value.replace(',', '.') })}
                placeholder="14250"
                className="w-full bg-white border border-line rounded-[10px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-success"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Date signature</label>
              <input
                type="date"
                value={value.signedAt}
                onChange={(e) => update({ signedAt: e.target.value })}
                className="w-full bg-white border border-line rounded-[10px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-success"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Financement</label>
            <select
              value={value.financingType}
              onChange={(e) => update({ financingType: e.target.value as FinancingType | '' })}
              className="w-full bg-white border border-line rounded-[10px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-success"
            >
              <option value="">— Sélectionner —</option>
              {FINANCING.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Kits</label>
            <input
              type="text"
              value={value.kits}
              onChange={(e) => update({ kits: e.target.value })}
              placeholder="Ex. 14 panneaux 600W + onduleur 6kVA"
              className="w-full bg-white border border-line rounded-[10px] px-2.5 py-1.5 text-sm focus:outline-none focus:border-success"
            />
          </div>
        </div>
      )}

      {/* Objection + notes */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Objection / blocage</label>
        <input
          type="text"
          value={value.objection}
          onChange={(e) => update({ objection: e.target.value })}
          placeholder="Argent · Partenaire · Logistique…"
          className="w-full bg-white border border-line rounded-[12px] px-3 py-2 text-sm focus:outline-none focus:border-or"
        />
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-1">Notes</label>
        <textarea
          rows={4}
          value={value.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Contexte de l'échange, points clés, prochaine étape…"
          className="w-full bg-white border border-line rounded-[12px] px-3 py-2 text-sm focus:outline-none focus:border-or"
        />
      </div>
    </div>
  )
}

function MotifSelector({
  label,
  tone,
  options,
  selected,
  onSelect,
}: {
  label: string
  tone: 'rouille' | 'info' | 'or'
  options: { value: string; label: string }[]
  selected: string
  onSelect: (value: string) => void
}) {
  const tc = TONE_CLASSES[tone]
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-faint mb-2">{label}</label>
      <div className="grid grid-cols-1 gap-1.5">
        {options.map((o) => {
          const sel = selected === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onSelect(o.value)}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold text-left transition-colors ${
                sel ? `${tc.selectedSimple} font-bold` : 'border-line bg-white text-muted hover:text-text hover:border-faint'
              }`}
            >
              <span>{o.label}</span>
              {sel && <Icon name="check" size={12} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const TONE_CLASSES = {
  success: {
    selected: 'border-success bg-success-tint text-success shadow-md',
    selectedSimple: 'border-success bg-success-tint text-success',
    hoverBg: 'bg-success-tint/30',
    iconBg: 'bg-success-tint',
    iconColor: 'text-success',
  },
  rouille: {
    selected: 'border-rouille bg-rouille-tint text-rouille shadow-md',
    selectedSimple: 'border-rouille bg-rouille-tint text-rouille',
    hoverBg: 'bg-rouille-tint/30',
    iconBg: 'bg-rouille-tint',
    iconColor: 'text-rouille',
  },
  or: {
    selected: 'border-or bg-or-tint text-or-dark shadow-md',
    selectedSimple: 'border-or bg-or-tint text-or-dark',
    hoverBg: 'bg-or-tint/30',
    iconBg: 'bg-or-tint',
    iconColor: 'text-or-dark',
  },
  info: {
    selected: 'border-info bg-info-tint text-info shadow-md',
    selectedSimple: 'border-info bg-info-tint text-info',
    hoverBg: 'bg-info-tint/30',
    iconBg: 'bg-info-tint',
    iconColor: 'text-info',
  },
} as const

const OUTCOME_HINT: Record<DebriefOutcome, string> = {
  vente: 'Le client a signé',
  non_vente: 'Le client refuse / abandonne',
  en_reflexion: 'Le client doit réfléchir',
  suivi_prevu: 'Rappel programmé',
}
