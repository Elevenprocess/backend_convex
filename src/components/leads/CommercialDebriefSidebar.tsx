import { useEffect, useMemo, useState } from 'react'
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

type FormState = {
  outcome: Outcome
  nonSaleReason: NonSaleReason | ''
  objection: Objection | ''
  notes: string
  quoteAmount: string
  signedAt: string
  kits: string
  paymentMethod: FinancingType | ''
}

const NON_SALE_REASONS: { value: NonSaleReason; label: string }[] = [
  { value: 'suivi_prevu', label: 'Suivi prévu' },
  { value: 'non_qualifie', label: 'Non qualifié' },
  { value: 'no_show', label: 'No-show' },
  { value: 'contact_annule', label: 'Contact annulé' },
  { value: 'annulation_administrative', label: 'Annulation administrative' },
  { value: 'pas_interesse', label: 'Pas intéressé' },
]

const OBJECTIONS: { value: Objection; label: string }[] = [
  { value: 'argent', label: 'Argent' },
  { value: 'logistique', label: 'Logistique' },
  { value: 'partenaire', label: 'Partenaire' },
  { value: 'peur', label: 'Peur' },
  { value: 'ecran_de_fumee', label: 'Écran de fumée' },
  { value: 'pas_objection', label: "Pas d'objection" },
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
  objection: '',
  notes: '',
  quoteAmount: '',
  signedAt: '',
  kits: '',
  paymentMethod: '',
}

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
      await updateRdv(selectedRdv.id, {
        result: outcomeToResult(form.outcome, form.nonSaleReason),
        nonSaleReason: form.outcome === 'non_vente' && form.nonSaleReason ? labelFromNonSaleReason(form.nonSaleReason) : null,
        objections: form.objection ? labelFromObjection(form.objection) : null,
        notes: form.notes.trim() || null,
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
                      <ChoiceChip key={r.value} active={form.nonSaleReason === r.value} label={r.label} onClick={() => update({ nonSaleReason: r.value })} />
                    ))}
                  </div>
                </FieldGroup>
                <FieldGroup label="Objection non surmontée">
                  <div className="grid grid-cols-2 gap-1.5">
                    {OBJECTIONS.map((o) => (
                      <ChoiceChip key={o.value} active={form.objection === o.value} label={o.label} onClick={() => update({ objection: o.value })} />
                    ))}
                  </div>
                </FieldGroup>
              </>
            )}

            {form.outcome === 'vente' && (
              <>
                <FieldGroup label="Objection surmontée">
                  <div className="grid grid-cols-2 gap-1.5">
                    {OBJECTIONS.map((o) => (
                      <ChoiceChip key={o.value} active={form.objection === o.value} label={o.label} onClick={() => update({ objection: o.value })} />
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
              <textarea
                value={form.notes}
                onChange={(e) => update({ notes: e.target.value })}
                rows={3}
                placeholder="Contexte, décision, prochaines étapes…"
                className="w-full resize-none rounded-xl border border-line bg-cream px-3 py-2 text-sm text-text outline-none focus:border-or"
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

function ChoiceChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-2.5 py-2 text-left text-[11px] font-bold transition ${
        active ? 'border-or bg-or-tint text-or-dark shadow-sm' : 'border-line bg-white text-muted hover:border-or/50'
      }`}
    >
      {label}
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
  return {
    outcome,
    nonSaleReason: nonSaleReasonFromLabel(rdv.nonSaleReason),
    objection: objectionFromLabel(rdv.objections),
    notes: rdv.notes ?? '',
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

function nonSaleReasonFromLabel(label: string | null): NonSaleReason | '' {
  if (!label) return ''
  return (NON_SALE_REASONS.find((r) => r.label === label)?.value ?? '') as NonSaleReason | ''
}

function objectionFromLabel(label: string | null): Objection | '' {
  if (!label) return ''
  return (OBJECTIONS.find((o) => o.label === label)?.value ?? '') as Objection | ''
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
