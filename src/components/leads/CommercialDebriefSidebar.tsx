import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { Icon, type IconName } from '../Icon'
import { useIsReadOnlyImpersonation } from '../../lib/auth'
import {
  fullName,
  type FinancingType,
  type LeadResponse,
  type RdvResponse,
  type RdvResult,
} from '../../lib/types'
import { useRdvList, updateRdv } from '../../lib/hooks'
import { createLeadDebrief } from '../../lib/api'

type Props = {
  lead: LeadResponse
  onClose: () => void
  onSaved?: () => void
  onValidated?: (outcome: 'vente' | 'non_vente') => void
  // Débrief SANS RDV depuis la fiche : on délègue au parent qui gère
  // l'attribution du projet (auto / sélecteur / création) puis enregistre.
  onSubmitFromFiche?: (
    payload: ReturnType<typeof formToDebriefPayload>,
    outcome: 'vente' | 'non_vente',
  ) => void
  onBack?: () => void
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
  objection: Objection | ''
  acceptanceFactors: AcceptanceFactor[]
  notes: string
  quoteAmount: string
  signedAt: string
  kits: string
  paymentMethod: FinancingType | ''
}

const RESCHEDULE_REASONS = new Set<NonSaleReason>([
  'suivi_prevu',
  'no_show',
  'contact_annule',
  'annulation_administrative',
])

type SummaryCard = { label: string; sublabel?: string; tone: 'success' | 'rouille' | 'or' }

// ─── Wizard state machine ───────────────────────────────────────────
type WizardStepId =
  | 'result'        // Step 1 (toutes branches)
  | 'objection_v'   // Step 2V — objection surmontée (Vente)
  | 'acceptance_v'  // Step 3V — facteurs d'acceptation (Vente)
  | 'details_v'     // Step 4V — devis/date/kits/paiement (Vente)
  | 'reason_nv'     // Step 2NV — raison non-vente (Non-vente)
  | 'objection_nv'  // Step 3NV-A — objection non surmontée (Non-vente / Suivi prévu uniquement)
  | 'notes'         // Step final (toutes branches)

function getStepSequence(form: FormState): WizardStepId[] {
  if (form.outcome === '') return ['result']
  if (form.outcome === 'vente') {
    return ['result', 'objection_v', 'acceptance_v', 'details_v', 'notes']
  }
  // Non-vente
  if (form.nonSaleReason === '') return ['result', 'reason_nv']
  if (form.nonSaleReason === 'suivi_prevu') {
    return ['result', 'reason_nv', 'objection_nv', 'notes']
  }
  // Non qualifié, no_show, contact_annule, annulation_administrative, pas_interesse
  return ['result', 'reason_nv', 'notes']
}

function canAdvanceStep(stepId: WizardStepId, form: FormState): boolean {
  switch (stepId) {
    case 'result': return form.outcome !== ''
    case 'objection_v': return form.objection !== ''
    case 'acceptance_v': return form.acceptanceFactors.length > 0
    case 'details_v':
      return form.quoteAmount.trim() !== ''
        && form.signedAt !== ''
        && form.kits.trim() !== ''
        && form.paymentMethod !== ''
    case 'reason_nv': return form.nonSaleReason !== ''
    case 'objection_nv': return form.objection !== ''
    case 'notes': return true // step final, le bouton submit fait sa propre validation
  }
}

type DebriefStatus = 'en_attente' | 'signe' | 'non_qualifie'

const DEBRIEF_STATUS_META: Record<DebriefStatus, { label: string; badgeClass: string; dotClass: string }> = {
  en_attente: { label: 'En attente', badgeClass: 'bg-cream text-muted border-line', dotClass: 'bg-muted/50' },
  signe: { label: 'Signé', badgeClass: 'bg-success-tint text-success border-success/30', dotClass: 'bg-success' },
  non_qualifie: { label: 'Non qualifié', badgeClass: 'bg-rouille-tint text-rouille border-rouille/30', dotClass: 'bg-rouille' },
}

function resolveDebriefStatus(result: RdvResult | null | undefined): DebriefStatus {
  if (!result || result === 'reporte' || result === 'reflexion') return 'en_attente'
  if (result === 'signe') return 'signe'
  return 'non_qualifie'
}

const NON_SALE_REASONS: { value: NonSaleReason; label: string; hint: string }[] = [
  { value: 'suivi_prevu', label: 'Suivi prévu', hint: 'Je veux faire un suivi' },
  { value: 'non_qualifie', label: 'Non qualifié', hint: 'Le contact était faible' },
  { value: 'no_show', label: 'No-show', hint: 'Ne s\'est pas présenté' },
  { value: 'contact_annule', label: 'Contact annulé', hint: 'Le contact a annulé' },
  { value: 'annulation_administrative', label: 'Annulation administrative', hint: 'Annulé de notre côté' },
  { value: 'pas_interesse', label: 'Pas intéressé', hint: 'Pas envie de continuer' },
]

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

const PAYMENT_METHODS: { value: FinancingType; label: string; icon: IconName }[] = [
  { value: 'comptant', label: 'Comptant', icon: 'check' },
  { value: 'financement', label: 'Financement', icon: 'chart' },
  { value: 'paiement_10x', label: 'Paiement 10x', icon: 'calendar' },
]

const EMPTY_FORM: FormState = {
  outcome: '',
  nonSaleReason: '',
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
const PRECISION_PREFIX_RE = /^\[Précision:\s*([\s\S]*?)\]\s*(?:\n|$)/

export function CommercialDebriefSidebar({ lead, onClose, onSaved, onValidated, onSubmitFromFiche, onBack, className = '' }: Props) {
  const { data: rdvs, loading: rdvsLoading, refetch: refetchRdvs } = useRdvList({ leadId: lead.id })
  const sortedRdvs = useMemo(() => sortRdvsForDebrief(rdvs ?? []), [rdvs])
  const hasReporteHistory = useMemo(() => sortedRdvs.some((r) => r.status === 'reporte' || r.result === 'reporte'), [sortedRdvs])
  const [selectedRdvId, setSelectedRdvId] = useState<string | null>(sortedRdvs[0]?.id ?? null)
  const selectedRdv = useMemo(() => sortedRdvs.find((r) => r.id === selectedRdvId) ?? sortedRdvs[0] ?? null, [sortedRdvs, selectedRdvId])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successOverlay, setSuccessOverlay] = useState<null | { outcome: Outcome; label: string }>(null)
  const [currentStep, setCurrentStep] = useState<number>(0)
  const [transitionDirection, setTransitionDirection] = useState<'forward' | 'backward'>('forward')
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleSavedAt, setRescheduleSavedAt] = useState<string | null>(null)
  const readOnly = useIsReadOnlyImpersonation()

  // Auto-close 1.6s après une sauvegarde réussie pour libérer l'écran et signaler la fin.
  useEffect(() => {
    if (!successOverlay) return
    const timer = window.setTimeout(() => {
      setSuccessOverlay(null)
      onClose()
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [successOverlay, onClose])

  useEffect(() => {
    if (!selectedRdvId && sortedRdvs[0]) setSelectedRdvId(sortedRdvs[0].id)
  }, [sortedRdvs, selectedRdvId])

  // Reset l'overlay de succès si l'user change de lead pendant le timeout
  // d'auto-close — sinon le timer du précédent débrief fermerait le nouveau sidebar.
  useEffect(() => {
    setSuccessOverlay(null)
  }, [lead.id])

  useEffect(() => {
    setError(null)
    setRescheduleSavedAt(null)
    setForm(selectedRdv ? rdvToForm(selectedRdv) : EMPTY_FORM)
    const initialSlot = selectedRdv ? dateTimeInputsFromIso(selectedRdv.scheduledAt) : { date: '', time: '' }
    setRescheduleDate(initialSlot.date)
    setRescheduleTime(initialSlot.time)
    setCurrentStep(0)
    setTransitionDirection('forward')
  }, [selectedRdv?.id, selectedRdv?.scheduledAt])

  const update = (patch: Partial<FormState>) => {
    setForm((current) => {
      const next = { ...current, ...patch }

      // Reset cascade si outcome change
      if ('outcome' in patch && patch.outcome !== current.outcome) {
        next.nonSaleReason = ''
        next.objection = ''
        next.acceptanceFactors = []
        next.quoteAmount = ''
        next.signedAt = ''
        next.kits = ''
        next.paymentMethod = ''
        // notes préservées (saisie commune)
      }

      // Reset objection si on quitte la branche Suivi prévu
      if ('nonSaleReason' in patch && patch.nonSaleReason !== current.nonSaleReason) {
        if (patch.nonSaleReason !== 'suivi_prevu') {
          next.objection = ''
        }
      }

      return next
    })
  }

  const stepSequence = useMemo(() => getStepSequence(form), [form.outcome, form.nonSaleReason])
  const currentStepId = stepSequence[Math.min(currentStep, stepSequence.length - 1)]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep >= stepSequence.length - 1

  function goNext() {
    if (!canAdvanceStep(currentStepId, form)) return
    if (isLastStep) return
    setTransitionDirection('forward')
    setCurrentStep((s) => s + 1)
  }

  function goBack() {
    if (isFirstStep) return
    setTransitionDirection('backward')
    setCurrentStep((s) => Math.max(0, s - 1))
  }
  const toggleAcceptance = (factor: AcceptanceFactor) =>
    setForm((current) => ({
      ...current,
      acceptanceFactors: current.acceptanceFactors.includes(factor)
        ? current.acceptanceFactors.filter((f) => f !== factor)
        : [...current.acceptanceFactors, factor],
    }))

  const canSubmit =
    form.outcome !== '' &&
    (form.outcome === 'vente'
      ? form.quoteAmount.trim() !== '' && form.signedAt !== '' && form.kits.trim() !== '' && form.paymentMethod !== ''
      : form.nonSaleReason !== '')

  const canReschedule = Boolean(selectedRdv && rescheduleDate && rescheduleTime && !rescheduling && !readOnly)

  async function handleReschedule() {
    if (!selectedRdv || !rescheduleDate || !rescheduleTime || rescheduling || readOnly) return
    setRescheduling(true)
    setError(null)
    try {
      await updateRdv(selectedRdv.id, {
        scheduledAt: rdvAtToReunionIso(rescheduleDate, rescheduleTime),
        status: 'reporte',
        result: 'reporte',
      })
      setRescheduleSavedAt(new Date().toISOString())
      refetchRdvs()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du report du RDV')
    } finally {
      setRescheduling(false)
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const amount = form.quoteAmount.trim() === '' ? null : Number(form.quoteAmount.replace(',', '.'))
      if (form.outcome === 'vente' && (amount == null || Number.isNaN(amount))) {
        throw new Error('Valeur du devis invalide')
      }
      const debriefPayload = formToDebriefPayload(form, selectedRdv?.id ?? null)

      if (selectedRdv) {
        // Chemin RDV inchangé : effets métier via PATCH /rdv/:id.
        const composedNonSaleReason =
          form.outcome === 'non_vente' && form.nonSaleReason
            ? composeNonSaleReason(form.nonSaleReason)
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
        // Enrichissement analytics « Débrief qualifié » — best-effort : ne pas
        // faire échouer la sauvegarde du RDV si l'écriture du débrief échoue.
        try {
          await createLeadDebrief(lead.id, debriefPayload)
        } catch {
          /* noop : la donnée RDV reste la source pour ce cas */
        }
        refetchRdvs()
      } else if (onSubmitFromFiche) {
        // Pas de RDV, depuis la fiche : le parent gère l'attribution du projet
        // (auto / sélecteur / création) puis l'enregistrement + le feedback.
        onSubmitFromFiche(debriefPayload, form.outcome as 'vente' | 'non_vente')
        onClose()
        return
      } else {
        // Fallback : pas de RDV et pas de parent → débrief lead-level direct.
        await createLeadDebrief(lead.id, debriefPayload)
      }

      onSaved?.()
      if (form.outcome === 'vente' || form.outcome === 'non_vente') {
        onValidated?.(form.outcome)
      }
      const successLabel =
        form.outcome === 'vente'
          ? 'Vente enregistrée'
          : form.nonSaleReason
            ? labelFromNonSaleReason(form.nonSaleReason)
            : 'Débrief enregistré'
      setSuccessOverlay({ outcome: form.outcome, label: successLabel })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur à l\'enregistrement')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className={`flex flex-col w-full md:w-[460px] max-w-full md:max-w-[92vw] overflow-y-auto border-l border-line bg-white/95 backdrop-blur-2xl shadow-2xl ${className}`}>
      {successOverlay && <DebriefSuccessOverlay outcome={successOverlay.outcome} label={successOverlay.label} />}
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-5 py-4 backdrop-blur-2xl">
        {onBack && (
          <button type="button" onClick={onBack} className="absolute left-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Retour">
            <Icon name="arrow-left" size={16} />
          </button>
        )}
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full p-1.5 text-muted hover:bg-cream hover:text-text" aria-label="Fermer le débriefing">
          <Icon name="x" size={16} />
        </button>
        <div className="eyebrow text-or-dark">Débriefing commercial</div>
        <h2 className="mt-1 pr-8 text-base font-black text-text">{fullName(lead)}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {selectedRdv && (() => {
            const debriefStatus = resolveDebriefStatus(selectedRdv.result)
            const meta = DEBRIEF_STATUS_META[debriefStatus]
            return (
              <>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-black uppercase tracking-[0.08em] ${meta.badgeClass}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                  {meta.label}
                </span>
                {debriefStatus === 'en_attente' && hasReporteHistory && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rouille/30 bg-rouille-tint px-2 py-1 font-black uppercase tracking-[0.08em] text-rouille" title="RDV à reporter : le prospect reste en attente du nouveau débrief">
                    <Icon name="clock" size={10} />
                    À reporter
                  </span>
                )}
              </>
            )
          })()}
          {lead.phone && <span className="rounded-full bg-cream px-2 py-1 font-bold text-muted">{lead.phone}</span>}
        </div>
      </header>

      <div className="flex-1 px-5 py-4 space-y-4">
        {rdvsLoading && !sortedRdvs.length ? (
          <div className="space-y-3">
            <div className="h-12 animate-pulse rounded-2xl bg-cream-darker" />
            <div className="h-32 animate-pulse rounded-2xl bg-cream-darker" />
          </div>
        ) : (
          <>
            {sortedRdvs.length > 0 && (
              <RdvSelector rdvs={sortedRdvs} selectedId={selectedRdv?.id ?? null} onSelect={setSelectedRdvId} />
            )}

            {sortedRdvs.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line bg-white/40 px-4 py-3 text-center text-xs text-muted">
                Aucun RDV — débrief libre (rappel téléphonique, vente directe…).
              </div>
            )}

            {selectedRdv && form.outcome === 'non_vente' && form.nonSaleReason && RESCHEDULE_REASONS.has(form.nonSaleReason) && (
              <RescheduleCard
                date={rescheduleDate}
                time={rescheduleTime}
                saving={rescheduling}
                savedAt={rescheduleSavedAt}
                disabled={!canReschedule}
                onDateChange={setRescheduleDate}
                onTimeChange={setRescheduleTime}
                onSubmit={handleReschedule}
              />
            )}

            <ProgressDots total={stepSequence.length} currentIndex={Math.min(currentStep, stepSequence.length - 1)} />

            <div
              key={`${selectedRdv?.id ?? 'none'}-${currentStepId}`}
              className={`animate-slide-${transitionDirection}`}
            >
              {currentStepId === 'result' && <Step1Result form={form} update={update} />}
              {currentStepId === 'objection_v' && <Step2VObjection form={form} update={update} />}
              {currentStepId === 'acceptance_v' && <Step3VAcceptance form={form} update={update} toggleAcceptance={toggleAcceptance} />}
              {currentStepId === 'details_v' && <Step4VDetails form={form} update={update} />}
              {currentStepId === 'reason_nv' && <Step2NVReason form={form} update={update} />}
              {currentStepId === 'objection_nv' && <Step3NVObjection form={form} update={update} />}
              {currentStepId === 'notes' && <StepFinalNotes form={form} update={update} />}
            </div>

            {error && (
              <div className="rounded-xl border border-rouille/40 bg-rouille-tint px-3 py-2 text-xs font-bold text-rouille">{error}</div>
            )}
          </>
        )}
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-line bg-white/95 px-5 py-3 backdrop-blur-2xl space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={isFirstStep || saving}
              className={`rounded-2xl border border-line px-4 py-3 text-sm font-bold transition ${
                isFirstStep || saving
                  ? 'bg-cream-darker text-faint cursor-not-allowed'
                  : 'bg-white text-text hover:bg-cream'
              }`}
            >
              ← Retour
            </button>
            {!isLastStep ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canAdvanceStep(currentStepId, form) || saving}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${
                  canAdvanceStep(currentStepId, form) && !saving
                    ? 'bg-text text-white hover:bg-text/90 shadow-md'
                    : 'bg-cream-darker text-faint cursor-not-allowed'
                }`}
              >
                Continuer →
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSubmit || saving || readOnly}
                onClick={handleSubmit}
                className={`flex-1 rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${
                  canSubmit && !saving
                    ? 'bg-success text-white hover:bg-success/90 shadow-md'
                    : 'bg-cream-darker text-faint cursor-not-allowed'
                }`}
              >
                {saving ? 'Enregistrement…' : readOnly ? 'Lecture seule — impersonation' : 'Enregistrer le débrief'}
              </button>
            )}
          </div>
        </footer>
    </aside>
  )
}

// ─── Wizard step components ─────────────────────────────────────────

type StepProps = {
  form: FormState
  update: (patch: Partial<FormState>) => void
}

function Step1Result({ form, update }: StepProps) {
  return (
    <FieldGroup label="Résultat de l'appel" required>
      <div className="grid grid-cols-2 gap-2">
        <ChoicePill active={form.outcome === 'vente'} icon="check" label="Vente réalisée" tone="success" onClick={() => update({ outcome: 'vente' })} />
        <ChoicePill active={form.outcome === 'non_vente'} icon="x" label="Vente non réalisée" tone="rouille" onClick={() => update({ outcome: 'non_vente' })} />
      </div>
    </FieldGroup>
  )
}

function Step2VObjection({ form, update }: StepProps) {
  return (
    <FieldGroup label="Quelle objection avez-vous surmontée ?" required>
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
  )
}

type Step3VProps = StepProps & {
  toggleAcceptance: (factor: AcceptanceFactor) => void
}

function Step3VAcceptance({ form, update, toggleAcceptance }: Step3VProps) {
  return (
    <div className="space-y-4">
      <FieldGroup label="Facteurs d'acceptation" required>
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
      <FieldGroup label="Commentaire de validation">
        <AutoGrowTextarea
          value={form.notes}
          onChange={(e) => update({ notes: e.target.value })}
          minRows={3}
          maxRows={10}
          placeholder="Pourquoi le prospect valide ? Conditions, contexte, point fort décisif…"
          className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or"
        />
      </FieldGroup>
    </div>
  )
}

function Step4VDetails({ form, update }: StepProps) {
  return (
    <div className="space-y-4">
      {/* Bandeau : on cadre l'étape comme le moment de la vente gagnée */}
      <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success-tint px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success text-white shadow-sm">
          <Icon name="trophy" size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-success">Vente signée</div>
          <p className="text-xs font-bold text-text/70">Renseigne les détails du devis pour finaliser.</p>
        </div>
      </div>

      {/* Champ hero : la valeur du devis, c'est le chiffre qui compte */}
      <div className="rounded-2xl border border-success/40 bg-white p-4 shadow-sm">
        <label className="flex items-center justify-between text-[11px] font-black uppercase tracking-[0.14em] text-muted">
          <span>Valeur du devis signé <span className="text-rouille">*</span></span>
          <Icon name="sparkles" size={14} className="text-success" />
        </label>
        <div className="mt-2 flex items-baseline gap-2 border-b-2 border-success/20 pb-1 focus-within:border-success">
          <span className="text-2xl font-black text-success">€</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={form.quoteAmount}
            onChange={(e) => update({ quoteAmount: e.target.value })}
            placeholder="0,00"
            className="w-full bg-transparent text-3xl font-black tracking-tight text-text outline-none placeholder:text-faint/40"
          />
        </div>
      </div>

      <FieldGroup label="Date de signature" required>
        <div className="relative">
          <Icon name="calendar" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-or-dark" />
          <input
            type="date"
            value={form.signedAt}
            onChange={(e) => update({ signedAt: e.target.value })}
            className="w-full rounded-xl border border-line bg-cream py-2 pl-9 pr-3 text-sm font-bold text-text outline-none focus:border-or"
          />
        </div>
      </FieldGroup>

      <FieldGroup label="Kits vendus" required>
        <div className="relative">
          <Icon name="tag" size={15} className="pointer-events-none absolute left-3 top-3 text-or-dark" />
          <input
            type="text"
            value={form.kits}
            onChange={(e) => update({ kits: e.target.value })}
            placeholder="Ex. : 8 PV + 1 onduleur + 1 batterie 5 kWh"
            className="w-full rounded-xl border border-line bg-cream py-2 pl-9 pr-3 text-sm text-text outline-none focus:border-or"
          />
        </div>
      </FieldGroup>

      <FieldGroup label="Type de paiement" required>
        <div className="grid grid-cols-3 gap-1.5">
          {PAYMENT_METHODS.map((p) => (
            <PaymentPill
              key={p.value}
              active={form.paymentMethod === p.value}
              icon={p.icon}
              label={p.label}
              onClick={() => update({ paymentMethod: p.value })}
            />
          ))}
        </div>
      </FieldGroup>
    </div>
  )
}

function PaymentPill({ active, icon, label, onClick }: { active: boolean; icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition ${
        active ? 'border-success bg-success text-white shadow-md' : 'border-line bg-white text-muted hover:border-success/50'
      }`}
    >
      <Icon name={icon} size={16} />
      <span className="text-[11px] font-black leading-tight">{label}</span>
    </button>
  )
}

function Step2NVReason({ form, update }: StepProps) {
  return (
    <div className="space-y-4">
      <FieldGroup label="Raison de la non-vente" required>
        <div className="grid grid-cols-2 gap-1.5">
          {NON_SALE_REASONS.map((r) => (
            <ChoiceChip
              key={r.value}
              active={form.nonSaleReason === r.value}
              label={r.label}
              sublabel={r.hint}
              onClick={() => update({ nonSaleReason: r.value })}
            />
          ))}
        </div>
      </FieldGroup>
      <FieldGroup label="Commentaire sur la cause">
        <AutoGrowTextarea
          value={form.notes}
          onChange={(e) => update({ notes: e.target.value })}
          minRows={3}
          maxRows={10}
          placeholder="Détaille la cause : objection réelle, contexte, prochaine action possible…"
          className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or"
        />
      </FieldGroup>
    </div>
  )
}

function Step3NVObjection({ form, update }: StepProps) {
  return (
    <FieldGroup label="Quelle objection n'avez-vous pas pu surmonter ?" required>
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
  )
}

function StepFinalNotes({ form, update }: StepProps) {
  return (
    <div className="space-y-4">
      <DebriefSummaryCards form={form} />
      <FieldGroup label="Commentaire final du commercial">
        <AutoGrowTextarea
          value={form.notes}
          onChange={(e) => update({ notes: e.target.value })}
          minRows={4}
          maxRows={20}
          placeholder={notesPlaceholder(form)}
          className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or"
        />
        <p className="text-[10px] text-faint">Ce commentaire sera enregistré avec les choix cochés du débrief.</p>
      </FieldGroup>
    </div>
  )
}

function DebriefSummaryCards({ form }: { form: FormState }) {
  const cards = selectedDebriefCards(form)
  return (
    <div className="rounded-2xl border border-line bg-cream/35 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow text-or-dark">Résumé avant enregistrement</div>
          <h3 className="mt-0.5 text-sm font-black text-text">Cartes cochées par le commercial</h3>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-muted border border-line">{cards.length} choix</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {cards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-white/70 px-3 py-2 text-xs font-bold text-muted">Aucun choix coché pour le moment.</div>
        ) : cards.map((card, index) => (
          <div key={`${card.label}-${index}`} className="flex items-start gap-2 rounded-xl border border-line bg-white px-3 py-2 shadow-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${card.tone === 'success' ? 'bg-success' : card.tone === 'rouille' ? 'bg-rouille' : 'bg-or-dark'}`}>
              <Icon name="check" size={12} />
            </span>
            <span className="min-w-0">
              <strong className="block text-xs font-black text-text">{card.label}</strong>
              {card.sublabel && <small className="block text-[10px] leading-snug text-muted">{card.sublabel}</small>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DebriefSuccessOverlay({ outcome, label }: { outcome: Outcome; label: string }) {
  const isVente = outcome === 'vente'
  const tone = isVente ? 'success' : 'rouille'
  const ringClass = tone === 'success' ? 'bg-success' : 'bg-rouille'
  const ringSoftClass = tone === 'success' ? 'bg-success/30' : 'bg-rouille/30'
  const headline = isVente ? 'Vente enregistrée' : 'Débrief enregistré'
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-white/96 backdrop-blur-xl px-6 text-center"
    >
      <div className="relative h-24 w-24">
        <span className={`absolute inset-0 rounded-full ${ringSoftClass} debrief-success-ring`} />
        <span className={`relative flex h-24 w-24 items-center justify-center rounded-full ${ringClass} text-white shadow-lg debrief-success-pop`}>
          <Icon name="check" size={44} />
        </span>
      </div>
      <div className="debrief-success-fade space-y-1">
        <h3 className="text-lg font-black text-text">{headline}</h3>
        <p className="text-sm font-bold text-muted">{label}</p>
      </div>
      <div className="debrief-success-fade text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
        Le statut est mis à jour
      </div>
    </div>
  )
}

function RescheduleCard({
  date,
  time,
  saving,
  savedAt,
  disabled,
  onDateChange,
  onTimeChange,
  onSubmit,
}: {
  date: string
  time: string
  saving: boolean
  savedAt: string | null
  disabled: boolean
  onDateChange: (value: string) => void
  onTimeChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <section className="rounded-3xl border border-line bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-or-dark">
            <span className="flex h-7 w-7 items-center justify-center rounded-2xl bg-or-tint text-or-dark">
              <Icon name="calendar" size={14} />
            </span>
            RDV à reporter
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">Choisis la nouvelle date et l’heure avant de continuer le débrief.</p>
        </div>
        <div className="rounded-2xl border border-line bg-cream px-3 py-2 text-right sm:min-w-[118px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Jour</div>
          <div className="text-sm font-black text-text">{date ? formatDayLabel(date) : '—'}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_0.8fr]">
        <label className="rounded-2xl border border-line bg-cream px-3 py-2">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full bg-transparent text-sm font-bold text-text outline-none"
          />
        </label>
        <label className="rounded-2xl border border-line bg-cream px-3 py-2">
          <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-faint"><Icon name="clock" size={10} /> Heure</span>
          <input
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            className="w-full bg-transparent text-sm font-bold text-text outline-none"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        className={`mt-3 w-full rounded-2xl px-3 py-2.5 text-xs font-black transition ${
          disabled ? 'cursor-not-allowed bg-cream-darker text-faint' : 'bg-text text-white hover:bg-text/90'
        }`}
      >
        {saving ? 'Report en cours…' : 'Valider le report du RDV'}
      </button>
      {savedAt && (
        <p className="mt-2 rounded-xl border border-success/30 bg-success-tint px-3 py-2 text-[11px] font-bold text-success">
          RDV reporté · {formatTime(savedAt)}
        </p>
      )}
    </section>
  )
}

function ProgressDots({ total, currentIndex }: { total: number; currentIndex: number }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === currentIndex
                ? 'w-6 bg-or'
                : i < currentIndex
                ? 'w-1.5 bg-or-dark'
                : 'w-1.5 bg-line'
            }`}
          />
        ))}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
        Étape {currentIndex + 1} sur {total}
      </span>
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
  const { mainLabel } = splitNonSaleReason(rdv.nonSaleReason)
  const restoredNonSaleReason = nonSaleReasonFromLabel(mainLabel)
  // Un débrief non-vente peut avoir produit result = perdu | no_show | reflexion (suivi prévu)
  // ou un état historique 'reporte' (ancien comportement). On reflète "non_vente" dès qu'il y a
  // une raison ou un statut négatif, pour que le formulaire restaure la saisie à la réouverture.
  const isNonVente =
    rdv.result === 'perdu' ||
    rdv.result === 'no_show' ||
    rdv.result === 'reflexion' ||
    rdv.result === 'reporte' ||
    Boolean(restoredNonSaleReason)
  const outcome: Outcome = rdv.result === 'signe' ? 'vente' : isNonVente ? 'non_vente' : ''
  const { acceptance, freeText } = splitNotes(rdv.notes)
  return {
    outcome,
    nonSaleReason: restoredNonSaleReason,
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
    if (reason === 'suivi_prevu') return 'reflexion'
    // contact_annule, annulation_administrative, pas_interesse, non_qualifie → perdu
    // (la raison précise reste portée par nonSaleReason ; on ne marque PAS le RDV "à reporter")
    return 'perdu'
  }
  return null
}

function formToDebriefPayload(form: FormState, rdvId: string | null) {
  const isVente = form.outcome === 'vente'
  const amount =
    isVente && form.quoteAmount.trim() !== ''
      ? form.quoteAmount.trim().replace(',', '.')
      : null
  return {
    projectId: null as string | null,
    rdvId,
    outcome: (isVente ? 'vente' : 'non_vente') as 'vente' | 'non_vente',
    // nonSaleReason est conservé pour TOUS les motifs non-vente (y compris
    // suivi_prevu) : c'est ce que lit la carte « Raisons non-vente ».
    nonSaleReason: !isVente && form.nonSaleReason ? form.nonSaleReason : null,
    objection: form.objection ? labelFromObjection(form.objection) : null,
    acceptanceFactors: isVente ? form.acceptanceFactors : [],
    notes: form.notes.trim() || null,
    montantTotal: amount,
    financingType: isVente && form.paymentMethod ? form.paymentMethod : null,
    kits: isVente ? form.kits.trim() || null : null,
    signedAt: isVente && form.signedAt ? form.signedAt : null,
  }
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

function selectedDebriefCards(form: FormState): SummaryCard[] {
  const cards: SummaryCard[] = []
  if (form.outcome === 'vente') {
    cards.push({ label: 'Vente réalisée', sublabel: 'Le prospect a signé', tone: 'success' })
    if (form.objection) cards.push({ label: labelFromObjection(form.objection), sublabel: 'Objection surmontée', tone: 'or' })
    form.acceptanceFactors.forEach((factor) => cards.push({ label: labelFromAcceptance(factor), sublabel: 'Facteur d’acceptation', tone: 'success' }))
    if (form.quoteAmount.trim()) cards.push({ label: `${form.quoteAmount.trim()} €`, sublabel: 'Valeur du devis signé', tone: 'success' })
    if (form.signedAt) cards.push({ label: form.signedAt, sublabel: 'Date de signature', tone: 'success' })
    if (form.kits.trim()) cards.push({ label: form.kits.trim(), sublabel: 'Kits vendus', tone: 'success' })
    if (form.paymentMethod) cards.push({ label: PAYMENT_METHODS.find((p) => p.value === form.paymentMethod)?.label ?? form.paymentMethod, sublabel: 'Type de paiement', tone: 'success' })
  }
  if (form.outcome === 'non_vente') {
    cards.push({ label: 'Vente non réalisée', sublabel: 'À classer en non-vente', tone: 'rouille' })
    if (form.nonSaleReason) cards.push({ label: labelFromNonSaleReason(form.nonSaleReason), sublabel: NON_SALE_REASONS.find((r) => r.value === form.nonSaleReason)?.hint, tone: form.nonSaleReason === 'suivi_prevu' ? 'or' : 'rouille' })
    if (form.objection) cards.push({ label: labelFromObjection(form.objection), sublabel: 'Objection non surmontée', tone: 'rouille' })
  }
  return cards
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

function composeNonSaleReason(reason: NonSaleReason): string {
  return labelFromNonSaleReason(reason)
}

function splitNonSaleReason(raw: string | null): { mainLabel: string; subLabel: string } {
  if (!raw) return { mainLabel: '', subLabel: '' }
  const idx = raw.indexOf(NON_SALE_REASON_SEPARATOR)
  if (idx === -1) return { mainLabel: raw.trim(), subLabel: '' }
  return { mainLabel: raw.slice(0, idx).trim(), subLabel: raw.slice(idx + NON_SALE_REASON_SEPARATOR.length).trim() }
}

function composeNotes(form: FormState): string | null {
  const parts: string[] = []
  if (form.outcome === 'vente' && form.acceptanceFactors.length > 0) {
    const labels = form.acceptanceFactors.map(labelFromAcceptance).join(' | ')
    parts.push(`[Acceptation: ${labels}]`)
  }
  // Plus de [Précision: ...] — supprimé avec le commentaire libre par raison
  const free = form.notes.trim()
  if (free) parts.push(free)
  return parts.length ? parts.join('\n') : null
}

function splitNotes(raw: string | null): { acceptance: string[]; freeText: string } {
  if (!raw) return { acceptance: [], freeText: '' }
  let rest = raw
  let acceptance: string[] = []

  const accMatch = rest.match(ACCEPTANCE_PREFIX_RE)
  if (accMatch) {
    acceptance = accMatch[1].split('|').map((s) => s.trim()).filter(Boolean)
    rest = rest.replace(ACCEPTANCE_PREFIX_RE, '')
  }

  // Backward compat : si [Précision: ...] existe (ancien format), le merger dans freeText
  // avec préfixe visible "Précision : ..." pour que le commercial le voie et puisse l'éditer.
  const precMatch = rest.match(PRECISION_PREFIX_RE)
  if (precMatch) {
    const precision = precMatch[1].trim()
    rest = rest.replace(PRECISION_PREFIX_RE, '')
    rest = precision ? `Précision : ${precision}\n\n${rest.trim()}`.trim() : rest
  }

  return { acceptance, freeText: rest.trim() }
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

function dateTimeInputsFromIso(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Reunion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

function rdvAtToReunionIso(date: string, time: string): string {
  return `${date}T${time}:00+04:00`
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00+04:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'Indian/Reunion' }).format(d)
}

function formatRdvLabel(rdv: RdvResponse): string {
  const d = new Date(rdv.scheduledAt)
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Indian/Reunion' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Reunion' })
  const status = rdv.status === 'honore' ? '· honoré' : rdv.status === 'no_show' ? '· no-show' : rdv.status === 'reporte' ? '· reporté' : ''
  return `${date} ${time} ${status}`.trim()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Reunion' })
}
