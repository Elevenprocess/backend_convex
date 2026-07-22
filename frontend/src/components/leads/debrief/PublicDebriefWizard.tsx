import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon, type IconName } from '../../Icon'
import type { FinancingType, FinancingOrg, PaymentSubMethod } from '../../../lib/types'
import {
  PAYMENT_METHOD_CONFIG,
  PAYMENT_METHOD_ORDER,
  SUB_METHODS,
  FINANCING_ORGS,
  computeAcompteAmount,
  formatEuro,
  joinKits,
} from '../../../lib/debriefFinancing'

// ─────────────────────────────────────────────────────────────────────
// Wizard de débrief PUBLIC (lien magique) — parité avec le sidebar
// commercial, mais sans session : il reçoit les coordonnées du client + le
// RDV et délègue l'enregistrement / le report à des callbacks (token API).
// ─────────────────────────────────────────────────────────────────────

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
  kits: string[]
  paymentMethod: FinancingType | ''
  paymentSubMethod: PaymentSubMethod | ''
  financingOrg: FinancingOrg | ''
  acomptePercent: number | null
  acompteAmountInput: string
}

export type PublicDebriefPayload = {
  outcome: 'vente' | 'non_vente'
  nonSaleReason: NonSaleReason | null
  objection: string | null
  acceptanceFactors: AcceptanceFactor[]
  notes: string | null
  montantTotal: string | null
  financingType: FinancingType | null
  kits: string | null
  signedAt: string | null
  paymentSubMethod: PaymentSubMethod | null
  financingOrg: FinancingOrg | null
  acomptePercent: number | null
  acompteAmount: string | null
}

const RESCHEDULE_REASONS = new Set<NonSaleReason>([
  'suivi_prevu',
  'no_show',
  'contact_annule',
  'annulation_administrative',
])

type SummaryCard = { label: string; sublabel?: string; tone: 'success' | 'rouille' | 'or' }

type WizardStepId =
  | 'result'
  | 'objection_v'
  | 'acceptance_v'
  | 'details_v'
  | 'reason_nv'
  | 'objection_nv'
  | 'notes'

function getStepSequence(form: FormState): WizardStepId[] {
  if (form.outcome === '') return ['result']
  if (form.outcome === 'vente') return ['result', 'objection_v', 'acceptance_v', 'details_v', 'notes']
  if (form.nonSaleReason === '') return ['result', 'reason_nv']
  if (form.nonSaleReason === 'suivi_prevu') return ['result', 'reason_nv', 'objection_nv', 'notes']
  return ['result', 'reason_nv', 'notes']
}

function isFinancingComplete(form: FormState): boolean {
  if (!form.paymentMethod) return false
  const cfg = PAYMENT_METHOD_CONFIG[form.paymentMethod as keyof typeof PAYMENT_METHOD_CONFIG]
  if (!cfg) return false
  const subOk = cfg.subChoice === 'method' ? form.paymentSubMethod !== '' : form.financingOrg !== ''
  const acompteOk =
    form.acomptePercent != null ||
    (form.acompteAmountInput.trim() !== '' && Number(form.acompteAmountInput.replace(',', '.')) > 0)
  return subOk && acompteOk
}

function isVenteDetailsComplete(form: FormState): boolean {
  return form.quoteAmount.trim() !== '' && form.kits.length > 0 && isFinancingComplete(form)
}

function canAdvanceStep(stepId: WizardStepId, form: FormState): boolean {
  switch (stepId) {
    case 'result': return form.outcome !== ''
    case 'objection_v': return form.objection !== ''
    case 'acceptance_v': return form.acceptanceFactors.length > 0
    case 'details_v': return isVenteDetailsComplete(form)
    case 'reason_nv': return form.nonSaleReason !== ''
    case 'objection_nv': return form.objection !== ''
    case 'notes': return true
  }
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY_FORM: FormState = {
  outcome: '',
  nonSaleReason: '',
  objection: '',
  acceptanceFactors: [],
  notes: '',
  quoteAmount: '',
  signedAt: todayIso(),
  kits: [],
  paymentMethod: '',
  paymentSubMethod: '',
  financingOrg: '',
  acomptePercent: null,
  acompteAmountInput: '',
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

function composeNotes(form: FormState): string | null {
  const parts: string[] = []
  if (form.outcome === 'vente' && form.acceptanceFactors.length > 0) {
    parts.push(`[Acceptation: ${form.acceptanceFactors.map(labelFromAcceptance).join(' | ')}]`)
  }
  const free = form.notes.trim()
  if (free) parts.push(free)
  return parts.length ? parts.join('\n') : null
}

function formToPayload(form: FormState): PublicDebriefPayload {
  const isVente = form.outcome === 'vente'
  const amount = isVente && form.quoteAmount.trim() !== '' ? form.quoteAmount.trim().replace(',', '.') : null
  let acompteAmount: string | null = null
  if (isVente) {
    if (form.acomptePercent != null) {
      const computed = computeAcompteAmount(form.quoteAmount, form.acomptePercent)
      acompteAmount = computed != null ? computed.toFixed(2) : null
    } else if (form.acompteAmountInput.trim() !== '') {
      acompteAmount = Number(form.acompteAmountInput.replace(',', '.')).toFixed(2)
    }
  }
  return {
    outcome: isVente ? 'vente' : 'non_vente',
    nonSaleReason: !isVente && form.nonSaleReason ? form.nonSaleReason : null,
    objection: form.objection ? labelFromObjection(form.objection) : null,
    acceptanceFactors: isVente ? form.acceptanceFactors : [],
    notes: composeNotes(form),
    montantTotal: amount,
    financingType: isVente && form.paymentMethod ? form.paymentMethod : null,
    kits: isVente && form.kits.length > 0 ? joinKits(form.kits) : null,
    signedAt: isVente && form.signedAt ? form.signedAt : null,
    paymentSubMethod: isVente && form.paymentSubMethod ? form.paymentSubMethod : null,
    financingOrg: isVente && form.financingOrg ? form.financingOrg : null,
    acomptePercent: isVente ? form.acomptePercent : null,
    acompteAmount,
  }
}

function selectedDebriefCards(form: FormState): SummaryCard[] {
  const cards: SummaryCard[] = []
  if (form.outcome === 'vente') {
    cards.push({ label: 'Vente réalisée', sublabel: 'Le prospect a signé', tone: 'success' })
    if (form.objection) cards.push({ label: labelFromObjection(form.objection), sublabel: 'Objection surmontée', tone: 'or' })
    form.acceptanceFactors.forEach((f) => cards.push({ label: labelFromAcceptance(f), sublabel: 'Facteur d’acceptation', tone: 'success' }))
    if (form.quoteAmount.trim()) cards.push({ label: `${form.quoteAmount.trim()} €`, sublabel: 'Valeur du devis signé', tone: 'success' })
    if (form.kits.length > 0) cards.push({ label: joinKits(form.kits), sublabel: 'Kits vendus', tone: 'success' })
    if (form.paymentMethod) {
      const cfg = PAYMENT_METHOD_CONFIG[form.paymentMethod as keyof typeof PAYMENT_METHOD_CONFIG]
      const sub = form.paymentSubMethod
        ? SUB_METHODS.find((m) => m.value === form.paymentSubMethod)?.label
        : form.financingOrg
          ? FINANCING_ORGS.find((o) => o.value === form.financingOrg)?.label
          : ''
      const label = [cfg?.label, sub].filter(Boolean).join(' · ')
      cards.push({ label: label || (cfg?.label ?? form.paymentMethod), sublabel: 'Financement', tone: 'success' })
    }
    if (form.acomptePercent != null) {
      const computed = computeAcompteAmount(form.quoteAmount, form.acomptePercent)
      if (computed != null) cards.push({ label: `${formatEuro(computed)} € (${form.acomptePercent} %)`, sublabel: 'Acompte', tone: 'success' })
    } else if (form.acompteAmountInput.trim() !== '') {
      cards.push({ label: `${form.acompteAmountInput.trim()} €`, sublabel: 'Acompte', tone: 'success' })
    }
  }
  if (form.outcome === 'non_vente') {
    cards.push({ label: 'Vente non réalisée', sublabel: 'À classer en non-vente', tone: 'rouille' })
    if (form.nonSaleReason)
      cards.push({ label: labelFromNonSaleReason(form.nonSaleReason), sublabel: NON_SALE_REASONS.find((r) => r.value === form.nonSaleReason)?.hint, tone: form.nonSaleReason === 'suivi_prevu' ? 'or' : 'rouille' })
    if (form.objection) cards.push({ label: labelFromObjection(form.objection), sublabel: 'Objection non surmontée', tone: 'rouille' })
  }
  return cards
}

function notesPlaceholder(form: FormState): string {
  if (form.outcome === 'non_vente' && form.nonSaleReason === 'non_qualifie') return 'Pourquoi pas qualifié ? Contexte, détail du blocage…'
  if (form.outcome === 'non_vente') return 'Contexte, prochaines étapes prévues, ressenti…'
  if (form.outcome === 'vente') return 'Détail de la signature, prochaines étapes (installation, financement)…'
  return 'Contexte, décision, prochaines étapes…'
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00+04:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'Indian/Reunion' }).format(d)
}

function dateTimeInputsFromIso(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Reunion',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function rdvAtToReunionIso(date: string, time: string): string {
  return `${date}T${time}:00+04:00`
}

// ─── Persistance locale du brouillon (anti-perte au refresh) ────────
// Les sélections du commercial sont sauvegardées dans le localStorage,
// indexées par RDV. Un rafraîchissement / une fermeture d'onglet ne perd
// donc plus la saisie en cours. Le brouillon est purgé après envoi.

const DRAFT_PREFIX = 'ecoi.debriefDraft:'
const draftKey = (rdvId: string) => `${DRAFT_PREFIX}${rdvId}`

type DraftShape = { form: Partial<FormState>; step: number }

function loadDraft(rdvId: string): DraftShape | null {
  try {
    const raw = localStorage.getItem(draftKey(rdvId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftShape
    if (!parsed || typeof parsed !== 'object' || !parsed.form) return null
    return parsed
  } catch {
    return null
  }
}

function saveDraft(rdvId: string, form: FormState, step: number) {
  try {
    localStorage.setItem(draftKey(rdvId), JSON.stringify({ form, step }))
  } catch {
    /* quota / mode privé : on ignore silencieusement */
  }
}

function clearDraft(rdvId: string) {
  try {
    localStorage.removeItem(draftKey(rdvId))
  } catch {
    /* ignore */
  }
}

// ─── Composant principal ────────────────────────────────────────────

type Props = {
  client: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null } | null
  commercialName: string | null
  rdv: { id: string; scheduledAt: string | null; status: string; alreadyDebriefed: boolean }
  initialForm?: Partial<FormState>
  onSubmit: (payload: PublicDebriefPayload) => Promise<void>
  onReschedule: (iso: string) => Promise<void>
}

export function PublicDebriefWizard({ client, commercialName, rdv, initialForm, onSubmit, onReschedule }: Props) {
  // Restaure un éventuel brouillon local (saisie non envoyée avant un refresh).
  // Priorité : brouillon local > débrief déjà enregistré (initialForm) > vide.
  const draft = useMemo(() => loadDraft(rdv.id), [rdv.id])
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initialForm, ...draft?.form })
  const [currentStep, setCurrentStep] = useState(draft?.step ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Sauvegarde le brouillon à chaque changement, tant que rien n'est envoyé.
  useEffect(() => {
    if (done) return
    saveDraft(rdv.id, form, currentStep)
  }, [rdv.id, form, currentStep, done])

  const slot = dateTimeInputsFromIso(rdv.scheduledAt)
  const [rescheduleDate, setRescheduleDate] = useState(slot.date)
  const [rescheduleTime, setRescheduleTime] = useState(slot.time)
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleDone, setRescheduleDone] = useState(false)

  const update = (patch: Partial<FormState>) => {
    setForm((current) => {
      const next = { ...current, ...patch }
      if ('outcome' in patch && patch.outcome !== current.outcome) {
        next.nonSaleReason = ''
        next.objection = ''
        next.acceptanceFactors = []
        next.quoteAmount = ''
        next.signedAt = todayIso()
        next.kits = []
        next.paymentMethod = ''
        next.paymentSubMethod = ''
        next.financingOrg = ''
        next.acomptePercent = null
        next.acompteAmountInput = ''
      }
      if ('nonSaleReason' in patch && patch.nonSaleReason !== current.nonSaleReason && patch.nonSaleReason !== 'suivi_prevu') {
        next.objection = ''
      }
      return next
    })
  }
  const toggleAcceptance = (factor: AcceptanceFactor) =>
    setForm((c) => ({
      ...c,
      acceptanceFactors: c.acceptanceFactors.includes(factor)
        ? c.acceptanceFactors.filter((f) => f !== factor)
        : [...c.acceptanceFactors, factor],
    }))

  const stepSequence = useMemo(() => getStepSequence(form), [form.outcome, form.nonSaleReason])
  const currentStepId = stepSequence[Math.min(currentStep, stepSequence.length - 1)]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep >= stepSequence.length - 1

  const canSubmit =
    form.outcome !== '' && (form.outcome === 'vente' ? isVenteDetailsComplete(form) : form.nonSaleReason !== '')
  const showReschedule =
    form.outcome === 'non_vente' && form.nonSaleReason !== '' && RESCHEDULE_REASONS.has(form.nonSaleReason as NonSaleReason)
  const canReschedule = Boolean(rescheduleDate && rescheduleTime && !rescheduling)

  async function handleReschedule() {
    if (!canReschedule) return
    setRescheduling(true)
    setError(null)
    try {
      await onReschedule(rdvAtToReunionIso(rescheduleDate, rescheduleTime))
      clearDraft(rdv.id)
      setRescheduleDone(true)
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
      if (form.outcome === 'vente') {
        const amount = form.quoteAmount.trim() === '' ? null : Number(form.quoteAmount.replace(',', '.'))
        if (amount == null || Number.isNaN(amount)) throw new Error('Valeur du devis invalide')
      }
      await onSubmit(formToPayload(form))
      clearDraft(rdv.id)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur à l\'enregistrement')
    } finally {
      setSaving(false)
    }
  }

  const clientName = [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim() || 'Client'

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center shadow-sm">
        <div className="relative mx-auto mb-4 h-20 w-20">
          <span className="absolute inset-0 rounded-full bg-success/25 debrief-success-ring" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-success text-white shadow-lg debrief-success-pop">
            <Icon name="check" size={40} />
          </span>
        </div>
        <h2 className="text-xl font-black text-text">
          {form.outcome === 'vente' ? 'Vente enregistrée' : 'Débrief enregistré'}
        </h2>
        <p className="mt-2 text-sm text-muted">Merci, ton débrief a bien été sauvegardé.</p>
      </div>
    )
  }

  const initials = clientName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'C'

  return (
    <div className="space-y-5 pb-28">
      {/* Bandeau marque */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow text-or-dark">VELORA · Débrief</div>
          {currentStep > 0 && (
            <div className="mt-0.5 truncate text-xs font-bold text-muted">{clientName}</div>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-muted">
          Étape {Math.min(currentStep, stepSequence.length - 1) + 1}/{stepSequence.length}
        </span>
      </div>

      {/* Carte client — visible uniquement à la 1re étape (le choix vente / non-vente).
          Dès qu'on avance, elle disparaît pour laisser toute la place aux choix à cocher. */}
      {currentStep === 0 && (
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-or-tint text-base font-black text-or-dark">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black text-text">{clientName}</h1>
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-faint">Débrief du rendez-vous</div>
            </div>
          </div>
          <div className="mt-4 grid gap-1.5">
            {client?.email && <InfoRow icon="mail" text={client.email} />}
            {client?.phone && <InfoRow icon="phone" text={client.phone} />}
            <InfoRow icon="calendar" text={formatRdvFull(rdv.scheduledAt)} />
            {commercialName && <InfoRow icon="users" text={`Commercial · ${commercialName}`} />}
          </div>
          {rdv.alreadyDebriefed && (
            <div className="mt-3 rounded-xl border border-or/30 bg-or-tint px-3 py-2 text-xs font-bold text-or-dark">
              Ce RDV a déjà un débrief — tu peux le compléter ou le corriger.
            </div>
          )}
        </div>
      )}

      {/* Report de RDV (cas non-vente avec suivi) */}
      {showReschedule && (
        <RescheduleCard
          date={rescheduleDate}
          time={rescheduleTime}
          saving={rescheduling}
          done={rescheduleDone}
          disabled={!canReschedule}
          onDateChange={(v) => { setRescheduleDate(v); setRescheduleDone(false) }}
          onTimeChange={(v) => { setRescheduleTime(v); setRescheduleDone(false) }}
          onSubmit={handleReschedule}
        />
      )}

      <ProgressDots total={stepSequence.length} currentIndex={Math.min(currentStep, stepSequence.length - 1)} />

      <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
        {currentStepId === 'result' && <Step1Result form={form} update={update} />}
        {currentStepId === 'objection_v' && <Step2VObjection form={form} update={update} />}
        {currentStepId === 'acceptance_v' && <Step3VAcceptance form={form} update={update} toggleAcceptance={toggleAcceptance} />}
        {currentStepId === 'details_v' && <Step4VDetails form={form} update={update} />}
        {currentStepId === 'reason_nv' && <Step2NVReason form={form} update={update} />}
        {currentStepId === 'objection_nv' && <Step3NVObjection form={form} update={update} />}
        {currentStepId === 'notes' && <StepFinalNotes form={form} update={update} />}
      </div>

      {error && <div className="rounded-xl border border-rouille/40 bg-rouille-tint px-3 py-2 text-sm font-bold text-rouille">{error}</div>}

      {/* Barre d'action fixe en bas */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg flex-col gap-2 px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {/* Bouton primaire : pleine largeur. Au 1er écran (choix vente/pas), c'est
              le seul bouton — pas de « Retour ». */}
          {!isLastStep ? (
            <button
              type="button"
              onClick={() => { if (canAdvanceStep(currentStepId, form)) setCurrentStep((s) => s + 1) }}
              disabled={!canAdvanceStep(currentStepId, form) || saving}
              className={`w-full rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${canAdvanceStep(currentStepId, form) && !saving ? 'bg-text text-white hover:bg-text/90 shadow-sm' : 'bg-cream-darker text-faint cursor-not-allowed'}`}
            >
              Continuer →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className={`w-full rounded-2xl px-4 py-3 text-sm font-black tracking-wide transition ${canSubmit && !saving ? 'bg-success text-white hover:bg-success/90 shadow-sm' : 'bg-cream-darker text-faint cursor-not-allowed'}`}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer le débrief'}
            </button>
          )}
          {/* « Retour » : seulement après le 1er écran, pleine largeur en bas. */}
          {!isFirstStep && (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
              disabled={saving}
              className={`w-full rounded-2xl border px-4 py-3 text-sm font-bold transition ${saving ? 'border-line bg-cream-darker text-faint cursor-not-allowed' : 'border-line bg-white text-text hover:bg-cream'}`}
            >
              ← Retour
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-cream/40 px-3 py-2.5 text-sm">
      <Icon name={icon} size={15} className="shrink-0 text-faint" />
      <span className="truncate font-medium text-text/80">{text}</span>
    </div>
  )
}

function formatRdvFull(iso: string | null): string {
  if (!iso) return 'date inconnue'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Reunion', weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

// ─── Étapes ─────────────────────────────────────────────────────────

type StepProps = { form: FormState; update: (patch: Partial<FormState>) => void }

function Step1Result({ form, update }: StepProps) {
  return (
    <FieldGroup label="Résultat du rendez-vous" required>
      <div className="grid grid-cols-2 gap-2.5">
        <ChoicePill active={form.outcome === 'vente'} icon="check" label="Vente réalisée" tone="success" onClick={() => update({ outcome: 'vente' })} />
        <ChoicePill active={form.outcome === 'non_vente'} icon="x" label="Vente non réalisée" tone="rouille" onClick={() => update({ outcome: 'non_vente' })} />
      </div>
      <p className="mt-1 text-[10px] text-faint">Choisis le résultat, puis continue pour renseigner les détails.</p>
    </FieldGroup>
  )
}

function Step2VObjection({ form, update }: StepProps) {
  return (
    <FieldGroup label="Quelle objection avez-vous surmontée ?" required>
      <div className="grid grid-cols-2 gap-1.5">
        {OBJECTIONS.map((o) => (
          <ChoiceChip key={o.value} active={form.objection === o.value} label={o.label} sublabel={o.hint} onClick={() => update({ objection: form.objection === o.value ? '' : o.value })} />
        ))}
      </div>
    </FieldGroup>
  )
}

function Step3VAcceptance({ form, update, toggleAcceptance }: StepProps & { toggleAcceptance: (f: AcceptanceFactor) => void }) {
  return (
    <div className="space-y-4">
      <FieldGroup label="Facteurs d'acceptation" required>
        <div className="grid grid-cols-2 gap-1.5">
          {ACCEPTANCE_FACTORS.map((f) => (
            <ChoiceChip key={f.value} active={form.acceptanceFactors.includes(f.value)} label={f.label} onClick={() => toggleAcceptance(f.value)} />
          ))}
        </div>
        <p className="mt-1 text-[10px] text-faint">Sélection multiple — pourquoi le prospect a dit oui.</p>
      </FieldGroup>
      <FieldGroup label="Commentaire de validation">
        <AutoGrowTextarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} minRows={3} maxRows={10} placeholder="Pourquoi le prospect valide ? Conditions, contexte, point fort décisif…" className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or" />
      </FieldGroup>
    </div>
  )
}

function Step4VDetails({ form, update }: StepProps) {
  const [kitInput, setKitInput] = useState('')
  const addKit = () => {
    const v = kitInput.trim()
    if (!v) return
    update({ kits: [...form.kits, v] })
    setKitInput('')
  }
  const removeKit = (idx: number) => update({ kits: form.kits.filter((_, i) => i !== idx) })

  const methodCfg = form.paymentMethod ? PAYMENT_METHOD_CONFIG[form.paymentMethod as keyof typeof PAYMENT_METHOD_CONFIG] : null
  const computed = form.acomptePercent != null ? computeAcompteAmount(form.quoteAmount, form.acomptePercent) : null
  const acompteValue = form.acomptePercent != null ? computed : form.acompteAmountInput.trim() !== '' ? Number(form.acompteAmountInput.replace(',', '.')) : null
  const quoteValue = form.quoteAmount.trim() !== '' ? Number(form.quoteAmount.replace(',', '.')) : null
  const resteAPayer = quoteValue != null && !Number.isNaN(quoteValue) && acompteValue != null && !Number.isNaN(acompteValue) ? Math.max(0, quoteValue - acompteValue) : null

  const pickMethod = (value: (typeof PAYMENT_METHOD_ORDER)[number]) =>
    update({ paymentMethod: value, paymentSubMethod: '', financingOrg: '', acomptePercent: null, acompteAmountInput: '' })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success-tint px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success text-white shadow-sm"><Icon name="trophy" size={18} /></span>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-success">Vente signée</div>
          <p className="text-xs font-bold text-text/70">Renseigne les détails du devis pour finaliser.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-success/40 bg-white p-4 shadow-sm">
        <label className="flex items-center justify-between text-[11px] font-black uppercase tracking-[0.14em] text-muted">
          <span>Valeur du devis signé (TTC) <span className="text-rouille">*</span></span>
          <Icon name="sparkles" size={14} className="text-success" />
        </label>
        <div className="mt-2 flex items-baseline gap-2 border-b-2 border-success/20 pb-1 focus-within:border-success">
          <span className="text-2xl font-black text-success">€</span>
          <input type="number" inputMode="decimal" min={0} step="0.01" value={form.quoteAmount} onChange={(e) => update({ quoteAmount: e.target.value })} placeholder="0,00" className="w-full bg-transparent text-3xl font-black tracking-tight text-text outline-none placeholder:text-faint/40" />
        </div>
      </div>

      <FieldGroup label="Kits vendus" required>
        <div className="flex gap-2">
          <input type="text" value={kitInput} onChange={(e) => setKitInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKit() } }} placeholder="Ex. : 8 PV, batterie 5 kWh…" className="w-full rounded-xl border border-line bg-cream py-2 px-3 text-sm text-text outline-none focus:border-or" />
          <button type="button" onClick={addKit} disabled={!kitInput.trim()} className="shrink-0 rounded-xl border border-or bg-or px-3 py-2 text-sm font-black text-white disabled:opacity-40">Ajouter</button>
        </div>
        {form.kits.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {form.kits.map((kit, idx) => (
              <span key={`${kit}-${idx}`} className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-tint px-2.5 py-1 text-[12px] font-bold text-success">
                {kit}
                <button type="button" onClick={() => removeKit(idx)} className="text-success/60 hover:text-success" aria-label={`Retirer ${kit}`}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </FieldGroup>

      <FieldGroup label="Financement" required>
        <div className="grid grid-cols-2 gap-1.5">
          {PAYMENT_METHOD_ORDER.map((value) => (
            <PaymentPill key={value} active={form.paymentMethod === value} icon={value === 'comptant' ? 'check' : value === 'financement' ? 'chart' : 'calendar'} label={PAYMENT_METHOD_CONFIG[value].label} onClick={() => pickMethod(value)} />
          ))}
        </div>
      </FieldGroup>

      {methodCfg && (
        <div className="space-y-4 rounded-2xl border border-line bg-cream/60 p-3">
          {methodCfg.subChoice === 'method' ? (
            <FieldGroup label="Moyen de paiement" required>
              <div className="grid grid-cols-3 gap-1.5">
                {SUB_METHODS.map((m) => (
                  <ChoiceChip key={m.value} active={form.paymentSubMethod === m.value} label={m.label} onClick={() => update({ paymentSubMethod: m.value })} />
                ))}
              </div>
            </FieldGroup>
          ) : (
            <FieldGroup label="Organisme de financement" required>
              <div className="grid grid-cols-2 gap-1.5">
                {FINANCING_ORGS.map((o) => (
                  <ChoiceChip key={o.value} active={form.financingOrg === o.value} label={o.label} onClick={() => update({ financingOrg: o.value })} />
                ))}
              </div>
            </FieldGroup>
          )}

          <FieldGroup label="Acompte" required>
            <div className="flex flex-wrap gap-1.5">
              {methodCfg.acomptePercents.map((pct) => (
                <ChoiceChip key={pct} active={form.acomptePercent === pct} label={`${pct} %`} onClick={() => update({ acomptePercent: pct, acompteAmountInput: '' })} />
              ))}
              <ChoiceChip active={form.acomptePercent == null && form.acompteAmountInput !== ''} label="Montant direct" onClick={() => update({ acomptePercent: null })} />
            </div>
            {form.acomptePercent == null && (
              <div className="mt-2 flex items-baseline gap-2 border-b-2 border-success/20 pb-1 focus-within:border-success">
                <span className="text-lg font-black text-success">€</span>
                <input type="number" inputMode="decimal" min={0} step="0.01" value={form.acompteAmountInput} onChange={(e) => update({ acompteAmountInput: e.target.value })} placeholder="Montant de l'acompte" className="w-full bg-transparent text-xl font-black text-text outline-none placeholder:text-faint/40" />
              </div>
            )}
            {acompteValue != null && !Number.isNaN(acompteValue) && acompteValue > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-success/30 bg-success-tint px-3 py-2 text-sm">
                <span className="font-black text-success">À payer : {formatEuro(acompteValue)} € TTC</span>
                {resteAPayer != null && <span className="font-bold text-text/70">Reste à payer : {formatEuro(resteAPayer)} € TTC</span>}
              </div>
            )}
          </FieldGroup>
        </div>
      )}
    </div>
  )
}

function Step2NVReason({ form, update }: StepProps) {
  return (
    <div className="space-y-4">
      <FieldGroup label="Raison de la non-vente" required>
        <div className="grid grid-cols-2 gap-1.5">
          {NON_SALE_REASONS.map((r) => (
            <ChoiceChip key={r.value} active={form.nonSaleReason === r.value} label={r.label} sublabel={r.hint} onClick={() => update({ nonSaleReason: r.value })} />
          ))}
        </div>
      </FieldGroup>
      <FieldGroup label="Commentaire sur la cause">
        <AutoGrowTextarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} minRows={3} maxRows={10} placeholder="Détaille la cause : objection réelle, contexte, prochaine action possible…" className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or" />
      </FieldGroup>
    </div>
  )
}

function Step3NVObjection({ form, update }: StepProps) {
  return (
    <FieldGroup label="Quelle objection n'avez-vous pas pu surmonter ?" required>
      <div className="grid grid-cols-2 gap-1.5">
        {OBJECTIONS.map((o) => (
          <ChoiceChip key={o.value} active={form.objection === o.value} label={o.label} sublabel={o.hint} onClick={() => update({ objection: form.objection === o.value ? '' : o.value })} />
        ))}
      </div>
    </FieldGroup>
  )
}

function StepFinalNotes({ form, update }: StepProps) {
  const cards = selectedDebriefCards(form)
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-cream/35 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow text-or-dark">Résumé avant enregistrement</div>
            <h3 className="mt-0.5 text-sm font-black text-text">Tes choix</h3>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-muted border border-line">{cards.length} choix</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {cards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-white/70 px-3 py-2 text-xs font-bold text-muted">Aucun choix coché pour le moment.</div>
          ) : cards.map((card, i) => (
            <div key={`${card.label}-${i}`} className="flex items-start gap-2 rounded-xl border border-line bg-white px-3 py-2 shadow-sm">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${card.tone === 'success' ? 'bg-success' : card.tone === 'rouille' ? 'bg-rouille' : 'bg-or-dark'}`}><Icon name="check" size={12} /></span>
              <span className="min-w-0">
                <strong className="block text-xs font-black text-text">{card.label}</strong>
                {card.sublabel && <small className="block text-[10px] leading-snug text-muted">{card.sublabel}</small>}
              </span>
            </div>
          ))}
        </div>
      </div>
      <FieldGroup label="Commentaire final">
        <AutoGrowTextarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} minRows={4} maxRows={20} placeholder={notesPlaceholder(form)} className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-or" />
        <p className="text-[10px] text-faint">Ce commentaire sera enregistré avec les choix cochés du débrief.</p>
      </FieldGroup>
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────

function RescheduleCard({ date, time, saving, done, disabled, onDateChange, onTimeChange, onSubmit }: { date: string; time: string; saving: boolean; done: boolean; disabled: boolean; onDateChange: (v: string) => void; onTimeChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <section className="glass-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-or-dark">
            <span className="flex h-7 w-7 items-center justify-center rounded-2xl bg-or-tint text-or-dark"><Icon name="calendar" size={14} /></span>
            Reporter le rendez-vous
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">Choisis la nouvelle date et l’heure du RDV.</p>
        </div>
        <div className="rounded-2xl border border-line bg-cream px-3 py-2 text-right sm:min-w-[118px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Jour</div>
          <div className="text-sm font-black text-text">{date ? formatDayLabel(date) : '—'}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_0.8fr]">
        <label className="rounded-2xl border border-line bg-cream px-3 py-2">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Date</span>
          <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} className="w-full bg-transparent text-sm font-bold text-text outline-none" />
        </label>
        <label className="rounded-2xl border border-line bg-cream px-3 py-2">
          <span className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-faint"><Icon name="clock" size={10} /> Heure</span>
          <input type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} className="w-full bg-transparent text-sm font-bold text-text outline-none" />
        </label>
      </div>
      <button type="button" onClick={onSubmit} disabled={disabled} className={`mt-3 w-full rounded-2xl px-3 py-2.5 text-xs font-black transition ${disabled ? 'cursor-not-allowed bg-cream-darker text-faint' : 'bg-text text-white hover:bg-text/90'}`}>
        {saving ? 'Report en cours…' : 'Valider le report du RDV'}
      </button>
      {done && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-success/30 bg-success-tint px-3 py-2 text-[11px] font-bold text-success">
          <Icon name="check" size={13} /> RDV reporté
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
          <span key={i} className={`h-1.5 rounded-full transition-all ${i === currentIndex ? 'w-6 bg-or' : i < currentIndex ? 'w-1.5 bg-or-dark' : 'w-1.5 bg-line'}`} />
        ))}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Étape {currentIndex + 1} sur {total}</span>
    </div>
  )
}

function FieldGroup({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-black uppercase tracking-[0.14em] text-muted">{label} {required && <span className="text-rouille">*</span>}</label>
      {children}
    </div>
  )
}

function ChoicePill({ active, icon, label, tone, onClick }: { active: boolean; icon: 'check' | 'x'; label: string; tone: 'success' | 'rouille'; onClick: () => void }) {
  const activeClasses = tone === 'success' ? 'border-success bg-success text-white shadow-md' : 'border-rouille bg-rouille text-white shadow-md'
  const iconWrap = active
    ? 'bg-white/20 text-white'
    : tone === 'success'
      ? 'bg-success-tint text-success'
      : 'bg-rouille-tint text-rouille'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-2.5 rounded-2xl border px-3 py-6 text-sm font-black transition ${active ? activeClasses : 'border-line bg-white text-text hover:border-or/50'}`}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-full ${iconWrap}`}>
        <Icon name={icon} size={22} />
      </span>
      {label}
    </button>
  )
}

function ChoiceChip({ active, label, sublabel, onClick }: { active: boolean; label: string; sublabel?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-xl border px-2.5 py-2 text-left transition ${active ? 'border-or bg-or-tint text-or-dark shadow-sm' : 'border-line bg-white text-muted hover:border-or/50'}`}>
      <div className="text-[11px] font-bold leading-tight">{label}</div>
      {sublabel && <div className="text-[9px] font-medium opacity-70 leading-tight mt-0.5">{sublabel}</div>}
    </button>
  )
}

function PaymentPill({ active, icon, label, onClick }: { active: boolean; icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition ${active ? 'border-success bg-success text-white shadow-md' : 'border-line bg-white text-muted hover:border-success/50'}`}>
      <Icon name={icon} size={16} />
      <span className="text-[11px] font-black leading-tight">{label}</span>
    </button>
  )
}

type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & { minRows?: number; maxRows?: number }

function AutoGrowTextarea({ minRows = 3, maxRows = 20, value, className = '', style, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = `${Math.min(lineHeight * maxRows, Math.max(lineHeight * minRows, el.scrollHeight))}px`
    el.style.overflowY = el.scrollHeight > lineHeight * maxRows ? 'auto' : 'hidden'
  }, [value, minRows, maxRows])
  return <textarea ref={ref} value={value} rows={minRows} className={`resize-none ${className}`} style={style} {...rest} />
}

// ─── Historique (débrief déjà envoyé) ───────────────────────────────
// Vue lecture seule affichée par la page lien magique à la place du wizard :
// le lien est permanent, le commercial peut le rouvrir pour vérifier que son
// débrief est bien parti sans se connecter à Velora. La re-soumission étant
// ignorée côté serveur (idempotence submitViaLink), on ne montre pas de
// formulaire — la correction passe par l'app.

export type ExistingDebrief = {
  sentAt?: number | null
  outcome: string
  nonSaleReason?: string | null
  objection?: string | null
  acceptanceFactors?: string[]
  notes?: string | null
  montantTotal?: number | null
  kits?: string | null
  signedAt?: number | null
}

function formatSentAt(ms: number | null | undefined): string | null {
  if (!ms) return null
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Indian/Reunion', weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms))
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-cream/40 px-3 py-2.5 text-sm">
      <span className="shrink-0 text-xs font-bold uppercase tracking-[0.08em] text-faint">{label}</span>
      <span className="text-right font-medium text-text/90">{value}</span>
    </div>
  )
}

type HistoryProps = {
  client: Props['client']
  commercialName: string | null
  rdv: Props['rdv']
  debrief: ExistingDebrief
}

export function PublicDebriefHistory({ client, commercialName, rdv, debrief }: HistoryProps) {
  const clientName = [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim() || 'Client'
  const initials = clientName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'C'
  const isVente = debrief.outcome === 'vente'
  const sentAt = formatSentAt(debrief.sentAt)
  const rows: { label: string; value: string }[] = []
  if (isVente) {
    if (debrief.montantTotal != null) rows.push({ label: 'Montant', value: `${formatEuro(debrief.montantTotal)} €` })
    if (debrief.kits) rows.push({ label: 'Kits', value: debrief.kits })
    if (debrief.signedAt) {
      rows.push({
        label: 'Signé le',
        value: new Intl.DateTimeFormat('fr-FR', { timeZone: 'Indian/Reunion', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(debrief.signedAt)),
      })
    }
  } else if (debrief.nonSaleReason) {
    rows.push({ label: 'Raison', value: labelFromNonSaleReason(debrief.nonSaleReason as NonSaleReason) })
  }
  if (debrief.objection) rows.push({ label: 'Objection', value: labelFromObjection(debrief.objection as Objection) })
  if (debrief.acceptanceFactors && debrief.acceptanceFactors.length > 0) {
    rows.push({ label: 'Acceptation', value: debrief.acceptanceFactors.map((f) => labelFromAcceptance(f as AcceptanceFactor)).join(', ') })
  }
  return (
    <div className="space-y-4">
      {/* Carte client — même en-tête que le wizard */}
      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-or-tint text-base font-black text-or-dark">
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black text-text">{clientName}</h1>
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-faint">Débrief du rendez-vous</div>
          </div>
        </div>
        <div className="mt-4 grid gap-1.5">
          <InfoRow icon="calendar" text={formatRdvFull(rdv.scheduledAt)} />
          {commercialName && <InfoRow icon="users" text={`Commercial · ${commercialName}`} />}
        </div>
      </div>

      {/* Historique : confirmation d'envoi + récap du débrief */}
      <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-white">
            <Icon name="check" size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-black text-text">Débrief déjà envoyé ✅</div>
            {sentAt && <div className="text-xs font-medium text-muted">Envoyé le {sentAt}</div>}
          </div>
        </div>
        <div className="mt-4 grid gap-1.5">
          <HistoryRow label="Résultat" value={isVente ? 'Vente réalisée' : 'Vente non réalisée'} />
          {rows.map((r) => <HistoryRow key={r.label} label={r.label} value={r.value} />)}
        </div>
        {debrief.notes && (
          <div className="mt-3 rounded-xl border border-line bg-cream/40 px-3 py-2.5">
            <div className="text-xs font-bold uppercase tracking-[0.08em] text-faint">Notes</div>
            <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-text/90">{debrief.notes}</p>
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          Rien d'autre à faire — ton débrief est bien enregistré. Besoin de le corriger ? Passe par l'application Velora.
        </p>
      </div>
    </div>
  )
}
