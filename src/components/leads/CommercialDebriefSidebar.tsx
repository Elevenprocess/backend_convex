import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { Icon } from '../Icon'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  fullName,
  type FinancingType,
  type LeadResponse,
  type RdvResponse,
  type RdvResult,
} from '../../lib/types'
import { useRdvList, updateRdv } from '../../lib/hooks'

type Props = {
  lead: LeadResponse
  onClose: () => void
  onSaved?: () => void
  className?: string
}

type Outcome = '' | 'vente' | 'non_vente'

type NonSaleReason =
  | 'suivi_prevu'
  | 'non_qualifie'
  | 'no_show'
  | 'contact_annule'
  | 'annulation_administrative'
  | 'pas_interesse'

type Objection = 'argent' | 'logistique' | 'partenaire' | 'peur' | 'ecran_de_fumee' | 'pas_objection'

type AcceptanceFactor =
  | 'prix_convenable'
  | 'confiance_commercial'
  | 'roi_rapide'
  | 'garanties'
  | 'recommandation'
  | 'batterie_autonomie'
  | 'financement_attractif'
  | 'aides_etat'
  | 'engagement_ecolo'
  | 'autre'

type FormState = {
  outcome: Outcome
  nonSaleReason: NonSaleReason | ''
  nonSaleSubReason: string
  objection: Objection | ''
  acceptanceFactors: AcceptanceFactor[]
  notes: string
  quoteAmount: string
  signedAt: string
  kits: string
  paymentMethod: FinancingType | ''
}

const NON_SALE_REASONS: { value: NonSaleReason; label: string; hint: string }[] = [
  { value: 'suivi_prevu', label: 'Suivi prévu', hint: 'Je veux faire un suivi' },
  { value: 'non_qualifie', label: 'Non qualifié', hint: 'Le contact était faible' },
  { value: 'no_show', label: 'No-show', hint: 'Ne s\'est pas présenté' },
  { value: 'contact_annule', label: 'Contact annulé', hint: 'Le contact a annulé' },
  { value: 'annulation_administrative', label: 'Annulation administrative', hint: 'Annulé de notre côté' },
  { value: 'pas_interesse', label: 'Pas intéressé', hint: 'Pas envie de continuer' },
]

// Sous-cas par raison de non-vente — affichés en chips conditionnels.
const NON_SALE_SUB_REASONS: Record<NonSaleReason, string[]> = {
  suivi_prevu: [
    'Devis en réflexion',
    'Attente accord conjoint / décideur',
    'Comparaison concurrent en cours',
    'Travaux préalables nécessaires',
    'Attente déblocage budget',
    'Autre',
  ],
  non_qualifie: [
    'Locataire / pas propriétaire',
    'Copropriété (refus AG)',
    'Toit incompatible (orientation/ombrage)',
    'Toit incompatible (matériau)',
    'Budget trop faible',
    'Pas le décideur',
    'Déjà équipé en PV',
    'Zone hors couverture',
    'Autre',
  ],
  no_show: [
    'Pas répondu au téléphone',
    'Annulation dernière minute',
    'Indisponible (maladie / urgence)',
    'Oubli déclaré',
    'Autre',
  ],
  contact_annule: [
    'Plus intéressé entre-temps',
    'A choisi un concurrent',
    'Reporté sine die',
    'Travaux annulés',
    'Autre',
  ],
  annulation_administrative: [
    'Erreur de planning ECOI',
    'Commercial indisponible',
    'Doublon RDV',
    'Re-qualification nécessaire',
    'Autre',
  ],
  pas_interesse: [
    'Démarchage ressenti',
    'Méfiance solaire',
    'Pas de retour économique perçu',
    'Mauvaise expérience passée',
    'Pas le bon moment',
    'Autre',
  ],
}

const OBJECTIONS: { value: Objection; label: string; hint: string }[] = [
  { value: 'argent', label: 'Argent', hint: "Je n'ai pas d'argent" },
  { value: 'logistique', label: 'Logistique', hint: 'Il faut trouver la solution' },
  { value: 'partenaire', label: 'Partenaire', hint: 'Je dois parler à mon partenaire' },
  { value: 'peur', label: 'Peur', hint: 'Je ne sais pas si vous pouvez m\'aider' },
  { value: 'ecran_de_fumee', label: 'Écran de fumée', hint: 'J\'ai poney demain…' },
  { value: 'pas_objection', label: "Pas d'objection", hint: 'Aucune objection restante' },
]

const ACCEPTANCE_FACTORS: { value: AcceptanceFactor; label: string }[] = [
  { value: 'prix_convenable', label: 'Prix convenable' },
  { value: 'confiance_commercial', label: 'Confiance dans le commercial' },
  { value: 'roi_rapide', label: 'ROI rapide démontré' },
  { value: 'garanties', label: 'Garanties rassurantes' },
  { value: 'recommandation', label: 'Recommandé par un proche' },
  { value: 'batterie_autonomie', label: 'Solution batterie / autonomie' },
  { value: 'financement_attractif', label: 'Financement attractif' },
  { value: 'aides_etat', label: 'Aides d\'État / TVA' },
  { value: 'engagement_ecolo', label: 'Engagement écologique' },
  { value: 'autre', label: 'Autre' },
]

const PAYMENT_METHODS: { value: FinancingType; label: string }[] = [
  { value: 'comptant', label: 'Comptant' },
  { value: 'financement_sans_apport', label: 'Financement sans apport' },
  { value: 'apport_financement', label: 'Apport + Financement' },
  { value: 'paiement_10x', label: 'Paiement 10x' },
]

const EMPTY_FORM: FormState = {
  outcome: '',
  nonSaleReason: '',
  nonSaleSubReason: '',
  objection: '',
  acceptanceFactors: [],
  notes: '',
  quoteAmount: '',
  signedAt: '',
  kits: '',
  paymentMethod: '',
}

const NON_SALE_REASON_SEPARATOR = ' — '
const ACCEPTANCE_PREFIX_RE = /^\[Acceptation:\s*([^\]]+)\]\s*\n?/

export function CommercialDebriefSidebar({ lead, onClose, onSaved, className = '' }: Props) {
  const { data: rdvs, loading: rdvsLoading, refetch: refetchRdvs } = useRdvList({ leadId: lead.id })
  const sortedRdvs = useMemo(() => sortRdvsForDebrief(rdvs ?? []), [rdvs])
  const [selectedRdvId, setSelectedRdvId] = useState<string | null>(sortedRdvs[0]?.id ?? null)
  const selectedRdv = useMemo(() => sortedRdvs.find((r) => r.id === selectedRdvId) ?? sortedRdvs[0] ?? null, [sortedRdvs, selectedRdvId])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedRdvId && sortedRdvs[0]) setSelectedRdvId(sortedRdvs[0].id)
  }, [sortedRdvs, selectedRdvId])

  useEffect(() => {
    setError(null)
    setSavedAt(null)
    setForm(selectedRdv ? rdvToForm(selectedRdv) : EMPTY_FORM)
  }, [selectedRdv?.id])

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }))

  const toggleAcceptance = (factor: AcceptanceFactor) =>
    setForm((current) => ({
      ...current,
      acceptanceFactors: current.acceptanceFactors.includes(factor)
        ? current.acceptanceFactors.filter((f) => f !== factor)
        : [...current.acceptanceFactors, factor],
    }))

  const subReasonOptions = form.nonSaleReason ? NON_SALE_SUB_REASONS[form.nonSaleReason] : []

  const canSubmit =
    !!selectedRdv &&
    form.outcome !== '' &&
    (form.outcome === 'vente'
      ? form.quoteAmount.trim() !== '' && form.signedAt !== '' && form.kits.trim() !== '' && form.paymentMethod !== ''
      : form.nonSaleReason !== '')

  async function handleSubmit() {
    if (!selectedRdv || !canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const amount = form.quoteAmount.trim() === '' ? null : Number(form.quoteAmount.replace(',', '.'))
      if (form.outcome === 'vente' && (amount == null || Number.isNaN(amount))) {
        throw new Error('Valeur du devis invalide')
      }
      const composedNonSaleReason =
        form.outcome === 'non_vente' && form.nonSaleReason
          ? composeNonSaleReason(form.nonSaleReason, form.nonSaleSubReason)
          : null
      const composedNotes = composeNotes(form)
      await updateRdv(selectedRdv.id, {
        result: outcomeToResult(form.outcome, form.nonSaleReason),
        nonSaleReason: composedNonSaleReason,
        objections: form.objection ? labelFromObjection(form.objection) : null,
        notes: composedNotes,
        montantTotal: form.outcome === 'vente' ? amount : null,
        signatureAt: form.outcome === 'vente' && form.signedAt ? form.signedAt : null,
        kits: form.outcome === 'vente' ? form.kits.trim() || null : null,
        financingType: form.outcome === 'vente' && form.paymentMethod ? form.paymentMethod : null,
        debriefFilledAt: new Date().toISOString(),
      })
      setSavedAt(new Date().toISOString())
      refetchRdvs()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur à l\'enregistrement')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className={`flex flex-col w-full md:w-[460px] max-w-full md:max-w-[92vw] overflow-y-auto border-l border-line bg-white/95 backdrop-blur-2xl shadow-2xl ${className}`}>
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-4 backdrop-blur-2xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Fermer le débriefing">
          <Icon name="x" size={16} />
        </button>
        <div className="eyebrow text-or-dark">Débriefing commercial</div>
        <h2 className="mt-1 pr-8 text-base font-black text-text">{fullName(lead)}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className={`status-badge ${STATUS_BADGE[lead.status] ?? 'bg-cream text-muted'}`}>{STATUS_LABEL[lead.status] ?? lead.status}</span>
          {lead.phone && <span className="rounded-full bg-cream px-2 py-1 font-bold text-muted">{lead.phone}</span>}
        </div>
      </header>

      <div className="flex-1 px-5 py-4 space-y-4">
        {rdvsLoading && !sortedRdvs.length ? (
          <div className="space-y-3">
            <div className="h-12 animate-pulse rounded-2xl bg-cream-darker" />
            <div className="h-32 animate-pulse rounded-2xl bg-cream-darker" />
          </div>
        ) : sortedRdvs.length === 0 ? (
          <EmptyDebrief />
        ) : (
          <>
            <RdvSelector rdvs={sortedRdvs} selectedId={selectedRdv?.id ?? null} onSelect={setSelectedRdvId} />

            {/* Q3 — Résultat */}
            <FieldGroup label="Résultat de l'appel" required>
              <div className="grid grid-cols-2 gap-2">
                <ChoicePill active={form.outcome === 'vente'} icon="check" label="Vente réalisée" tone="success" onClick={() => update({ outcome: 'vente' })} />
                <ChoicePill active={form.outcome === 'non_vente'} icon="x" label="Vente non réalisée" tone="rouille" onClick={() => update({ outcome: 'non_vente' })} />
              </div>
            </FieldGroup>

            {form.outcome === 'non_vente' && (
              <>
                <FieldGroup label="Raison de la non-vente" required>
                  <div className="grid grid-cols-2 gap-1.5">
                    {NON_SALE_REASONS.map((r) => (
                      <ChoiceChip
                        key={r.value}
                        active={form.nonSaleReason === r.value}
                        label={r.label}
                        sublabel={r.hint}
                        onClick={() => update({ nonSaleReason: r.value, nonSaleSubReason: '' })}
                      />
                    ))}
                  </div>
                </FieldGroup>

                {subReasonOptions.length > 0 && (
                  <FieldGroup label={`Précision — ${labelFromNonSaleReason(form.nonSaleReason as NonSaleReason)}`}>
                    <div className="grid grid-cols-2 gap-1.5">
                      {subReasonOptions.map((sub) => (
                        <ChoiceChip
                          key={sub}
                          active={form.nonSaleSubReason === sub}
                          label={sub}
                          onClick={() => update({ nonSaleSubReason: form.nonSaleSubReason === sub ? '' : sub })}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-faint">Optionnel — aide les stats à identifier les vrais blocages.</p>
                  </FieldGroup>
                )}

                <FieldGroup label="Objection non surmontée">
                  <div className="grid grid-cols-2 gap-1.5">
                    {OBJECTIONS.map((o) => (
                      <ChoiceChip
                        key={o.value}
                        active={form.objection === o.value}
                        label={o.label}
                        sublabel={o.hint}
                        onClick={() => update({ objection: form.objection === o.value ? '' : o.value })}
                      />
                    ))}
                  </div>
                </FieldGroup>
              </>
            )}

            {form.outcome === 'vente' && (
              <>
                <FieldGroup label="Facteurs d'acceptation">
                  <div className="grid grid-cols-2 gap-1.5">
                    {ACCEPTANCE_FACTORS.map((f) => (
                      <ChoiceChip
                        key={f.value}
                        active={form.acceptanceFactors.includes(f.value)}
                        label={f.label}
                        onClick={() => toggleAcceptance(f.value)}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-faint">Sélection multiple — pourquoi le prospect a dit oui.</p>
                </FieldGroup>

                <FieldGroup label="Objection surmontée">
                  <div className="grid grid-cols-2 gap-1.5">
                    {OBJECTIONS.map((o) => (
                      <ChoiceChip
                        key={o.value}
                        active={form.objection === o.value}
                        label={o.label}
                        sublabel={o.hint}
                        onClick={() => update({ objection: form.objection === o.value ? '' : o.value })}
                      />
                    ))}
                  </div>
                </FieldGroup>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FieldGroup label="Valeur du devis signé (€)" required>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={form.quoteAmount}
                      onChange={(e) => update({ quoteAmount: e.target.value })}
                      placeholder="0,00"
                      className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm font-bold text-text outline-none focus:border-or"
                    />
                  </FieldGroup>
                  <FieldGroup label="Date signature devis" required>
                    <input
                      type="date"
                      value={form.signedAt}
                      onChange={(e) => update({ signedAt: e.target.value })}
                      className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm font-bold text-text outline-none focus:border-or"
                    />
                  </FieldGroup>
                </div>

                <FieldGroup label="Kits vendus" required>
                  <input
                    type="text"
                    value={form.kits}
                    onChange={(e) => update({ kits: e.target.value })}
                    placeholder="Ex. : 8 PV + 1 onduleur + 1 batterie 5 kWh"
                    className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm text-text outline-none focus:border-or"
                  />
                </FieldGroup>

                <FieldGroup label="Type de paiement" required>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PAYMENT_METHODS.map((p) => (
                      <ChoiceChip key={p.value} active={form.paymentMethod === p.value} label={p.label} onClick={() => update({ paymentMethod: p.value })} />
                    ))}
                  </div>
                </FieldGroup>
              </>
            )}

            <FieldGroup label="Notes supplémentaires">
              <AutoGrowTextarea
                value={form.notes}
                onChange={(e) => update({ notes: e.target.value })}
                minRows={4}
                maxRows={20}
                placeholder={notesPlaceholder(form)}
                className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or"
              />
            </FieldGroup>

            {error && (
              <div className="rounded-xl border border-rouille/40 bg-rouille-tint px-3 py-2 text-xs font-bold text-rouille">{error}</div>
            )}
            {savedAt && !error && (
              <div className="rounded-xl border border-success/40 bg-success-tint px-3 py-2 text-xs font-bold text-success">
                Débrief enregistré · {formatTime(savedAt)}
              </div>
            )}
          </>
        )}
      </div>

      {sortedRdvs.length > 0 && (
        <footer className="sticky bottom-0 z-10 border-t border-line bg-white/95 px-5 py-3 backdrop-blur-2xl">
          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={handleSubmit}
            className={`w-full rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${
              canSubmit && !saving
                ? 'bg-text text-white hover:bg-text/90 shadow-md'
                : 'bg-cream-darker text-faint cursor-not-allowed'
            }`}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer le débrief'}
          </button>
          {!canSubmit && form.outcome === '' && (
            <p className="mt-2 text-center text-[11px] text-faint">Choisis un résultat pour activer l'enregistrement</p>
          )}
        </footer>
      )}
    </aside>
  )
}

function EmptyDebrief() {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-cream/40 px-5 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-or-tint text-or-dark">
        <Icon name="calendar" size={18} />
      </div>
      <p className="text-sm font-black text-text">Aucun RDV à débriefer</p>
      <p className="mt-1 text-xs text-muted">Le débrief commercial s'active dès qu'un RDV est planifié sur ce lead.</p>
    </div>
  )
}

function RdvSelector({ rdvs, selectedId, onSelect }: { rdvs: RdvResponse[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (rdvs.length <= 1) {
    const rdv = rdvs[0]
    if (!rdv) return null
    return (
      <div className="rounded-2xl border border-line bg-cream/40 px-3 py-2.5">
        <div className="eyebrow text-faint">RDV</div>
        <div className="mt-0.5 text-xs font-black text-text">{formatRdvLabel(rdv)}</div>
      </div>
    )
  }
  return (
    <div>
      <div className="eyebrow text-faint mb-1.5">RDV à débriefer</div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {rdvs.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
              selectedId === r.id
                ? 'border-or bg-or-tint text-or-dark shadow-sm'
                : 'border-line bg-white text-muted hover:border-or/50'
            }`}
          >
            {formatRdvLabel(r)}
          </button>
        ))}
      </div>
    </div>
  )
}

function FieldGroup({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-muted">
        {label} {required && <span className="text-rouille">*</span>}
      </label>
      {children}
    </div>
  )
}

function ChoicePill({ active, icon, label, tone, onClick }: { active: boolean; icon: 'check' | 'x'; label: string; tone: 'success' | 'rouille'; onClick: () => void }) {
  const activeClasses = tone === 'success'
    ? 'border-success bg-success text-white shadow-md'
    : 'border-rouille bg-rouille text-white shadow-md'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-black transition ${
        active ? activeClasses : 'border-line bg-white text-muted hover:border-or/50'
      }`}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  )
}

type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  minRows?: number
  maxRows?: number
}

function AutoGrowTextarea({ minRows = 3, maxRows = 20, value, className = '', style, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
    const min = lineHeight * minRows
    const max = lineHeight * maxRows
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, minRows, maxRows])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      className={`resize-none ${className}`}
      style={style}
      {...rest}
    />
  )
}

function ChoiceChip({ active, label, sublabel, onClick }: { active: boolean; label: string; sublabel?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-2.5 py-2 text-left transition ${
        active ? 'border-or bg-or-tint text-or-dark shadow-sm' : 'border-line bg-white text-muted hover:border-or/50'
      }`}
    >
      <div className="text-[11px] font-bold leading-tight">{label}</div>
      {sublabel && <div className="text-[9px] font-medium opacity-70 leading-tight mt-0.5">{sublabel}</div>}
    </button>
  )
}

// ─── helpers ────────────────────────────────────────────────────────

function sortRdvsForDebrief(rdvs: RdvResponse[]): RdvResponse[] {
  const priority = (r: RdvResponse): number => {
    if (r.status === 'honore') return 0
    if (r.status === 'no_show' || r.status === 'reporte') return 1
    if (r.status === 'planifie') return 2
    return 3
  }
  return [...rdvs].sort((a, b) => {
    const pa = priority(a)
    const pb = priority(b)
    if (pa !== pb) return pa - pb
    const ta = new Date(a.scheduledAt).getTime()
    const tb = new Date(b.scheduledAt).getTime()
    return tb - ta
  })
}

function rdvToForm(rdv: RdvResponse): FormState {
  const outcome: Outcome = rdv.result == null ? '' : rdv.result === 'signe' ? 'vente' : 'non_vente'
  const { mainLabel, subLabel } = splitNonSaleReason(rdv.nonSaleReason)
  const { acceptance, freeText } = splitNotes(rdv.notes)
  return {
    outcome,
    nonSaleReason: nonSaleReasonFromLabel(mainLabel),
    nonSaleSubReason: subLabel,
    objection: objectionFromLabel(rdv.objections),
    acceptanceFactors: acceptance.map(acceptanceFactorFromLabel).filter((f): f is AcceptanceFactor => f !== ''),
    notes: freeText,
    quoteAmount: rdv.montantTotal ?? '',
    signedAt: rdv.signatureAt ?? '',
    kits: rdv.kits ?? '',
    paymentMethod: (rdv.financingType ?? '') as FormState['paymentMethod'],
  }
}

function outcomeToResult(outcome: Outcome, reason: NonSaleReason | ''): RdvResult | null {
  if (outcome === 'vente') return 'signe'
  if (outcome === 'non_vente') {
    if (reason === 'no_show') return 'no_show'
    if (reason === 'annulation_administrative' || reason === 'contact_annule') return 'reporte'
    if (reason === 'suivi_prevu') return 'reflexion'
    return 'perdu'
  }
  return null
}

function labelFromNonSaleReason(value: NonSaleReason): string {
  return NON_SALE_REASONS.find((r) => r.value === value)?.label ?? value
}

function labelFromObjection(value: Objection): string {
  return OBJECTIONS.find((o) => o.value === value)?.label ?? value
}

function labelFromAcceptance(value: AcceptanceFactor): string {
  return ACCEPTANCE_FACTORS.find((f) => f.value === value)?.label ?? value
}

function nonSaleReasonFromLabel(label: string): NonSaleReason | '' {
  if (!label) return ''
  return (NON_SALE_REASONS.find((r) => r.label === label)?.value ?? '') as NonSaleReason | ''
}

function objectionFromLabel(label: string | null): Objection | '' {
  if (!label) return ''
  return (OBJECTIONS.find((o) => o.label === label)?.value ?? '') as Objection | ''
}

function acceptanceFactorFromLabel(label: string): AcceptanceFactor | '' {
  return (ACCEPTANCE_FACTORS.find((f) => f.label === label)?.value ?? '') as AcceptanceFactor | ''
}

function composeNonSaleReason(reason: NonSaleReason, sub: string): string {
  const main = labelFromNonSaleReason(reason)
  if (!sub.trim()) return main
  return `${main}${NON_SALE_REASON_SEPARATOR}${sub.trim()}`
}

function splitNonSaleReason(raw: string | null): { mainLabel: string; subLabel: string } {
  if (!raw) return { mainLabel: '', subLabel: '' }
  const idx = raw.indexOf(NON_SALE_REASON_SEPARATOR)
  if (idx === -1) return { mainLabel: raw.trim(), subLabel: '' }
  return { mainLabel: raw.slice(0, idx).trim(), subLabel: raw.slice(idx + NON_SALE_REASON_SEPARATOR.length).trim() }
}

function composeNotes(form: FormState): string | null {
  const free = form.notes.trim()
  if (form.outcome === 'vente' && form.acceptanceFactors.length > 0) {
    const labels = form.acceptanceFactors.map(labelFromAcceptance).join(' | ')
    const prefix = `[Acceptation: ${labels}]`
    return free ? `${prefix}\n${free}` : prefix
  }
  return free || null
}

function splitNotes(raw: string | null): { acceptance: string[]; freeText: string } {
  if (!raw) return { acceptance: [], freeText: '' }
  const match = raw.match(ACCEPTANCE_PREFIX_RE)
  if (!match) return { acceptance: [], freeText: raw }
  const acceptance = match[1].split('|').map((s) => s.trim()).filter(Boolean)
  const freeText = raw.replace(ACCEPTANCE_PREFIX_RE, '').trim()
  return { acceptance, freeText }
}

function notesPlaceholder(form: FormState): string {
  if (form.outcome === 'non_vente' && form.nonSaleReason === 'non_qualifie') {
    return 'Pourquoi pas qualifié ? Contexte, détail du blocage…'
  }
  if (form.outcome === 'non_vente') {
    return 'Contexte, prochaines étapes prévues, ressenti…'
  }
  if (form.outcome === 'vente') {
    return 'Détail de la signature, prochaines étapes (installation, financement)…'
  }
  return 'Contexte, décision, prochaines étapes…'
}

function formatRdvLabel(rdv: RdvResponse): string {
  const d = new Date(rdv.scheduledAt)
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const status = rdv.status === 'honore' ? '· honoré' : rdv.status === 'no_show' ? '· no-show' : rdv.status === 'reporte' ? '· reporté' : ''
  return `${date} ${time} ${status}`.trim()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
