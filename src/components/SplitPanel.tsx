import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { Spinner, LoadingBlock } from './Spinner'
import {
  STATUS_LABEL,
  STATUS_BADGE,
  CALL_RESULT_LABEL,
  fullName,
  initials as leadInitials,
  type CallResult,
  type LeadResponse,
  type RdvResponse,
  type UserResponse,
} from '../lib/types'
import { useCall, type CallState } from '../lib/call'
import { useCallLogs, useRdvList, createCallLog, createRdv, updateLead, copyText } from '../lib/hooks'
import { notifyClipboardCopied } from '../lib/clipboardToast'

type Tab = { id: string; label: string; icon?: IconName }

export type SplitPanelProps = {
  lead: LeadResponse
  userMap?: Map<string, UserResponse>
  tabs?: Tab[]
  defaultTab?: string
  children?: (activeTab: string) => ReactNode
  /** Si fourni, affiche un bouton réduire en haut du panneau. */
  onClose?: () => void
  onSaved?: () => void
  className?: string
}

const DEFAULT_TABS: Tab[] = [
  { id: 'infos', label: 'Infos', icon: 'eye' },
  { id: 'activite', label: 'Historique', icon: 'clock' },
  { id: 'appels', label: 'Appels', icon: 'phone' },
  { id: 'rdv', label: 'RDV', icon: 'calendar' },
  { id: 'notes', label: 'Notes', icon: 'edit' },
]

const QUICK_RESULTS: CallResult[] = ['joint', 'non_joint', 'rdv_pris', 'refus', 'messagerie']

type YesNo = '' | 'oui' | 'non'
type ActivityStatus = '' | 'actif' | 'retraite'

type EligibilityNotes = {
  isOwner: YesNo
  activity: ActivityStatus
  age: string
  projectTiming: string
  monthlyBill: string
  firstInfo: YesNo
  wantsBattery: YesNo
  batteryNote: string
  hasBudget: YesNo
  budgetNote: string
}

const EMPTY_ELIGIBILITY_NOTES: EligibilityNotes = {
  isOwner: '',
  activity: '',
  age: '',
  projectTiming: '',
  monthlyBill: '',
  firstInfo: '',
  wantsBattery: '',
  batteryNote: '',
  hasBudget: '',
  budgetNote: '',
}

function notesTabStorageKey(leadId: string): string {
  return `ecoi.notes-tab.v1.${leadId}`
}

export function SplitPanel({ lead, userMap, tabs = DEFAULT_TABS, defaultTab, children, onClose, onSaved, className }: SplitPanelProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0].id)
  const callState = useCall()
  const isActiveCallForThisLead = callState.active && callState.leadId === lead.id

  async function copyPhoneOnly() {
    if (!lead.phone) return
    await copyText(lead.phone)
    notifyClipboardCopied()
    setActive('notes')
  }

  return (
    <aside className={`w-[420px] border-l border-line bg-white/65 backdrop-blur-md flex flex-col flex-shrink-0 overflow-hidden ${className ?? ''}`}>
      {/* Header */}
      <div className="p-5 border-b border-line-soft flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-cuivre-tint flex items-center justify-center text-sm font-bold">{leadInitials(lead)}</div>
        <div className="flex-grow min-w-0">
          <div className="font-bold text-sm">{fullName(lead)}</div>
          <div className="text-xs text-faint truncate">{lead.phone ?? '—'}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
          </div>
        </div>
        <Link to={`/leads/${lead.id}`} className="text-xs font-semibold text-or hover:underline whitespace-nowrap">
          Fiche →
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-cream flex items-center justify-center text-faint hover:text-text"
            title="Réduire le panneau"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {/* Action bar */}
      <div className="p-4 border-b border-line-soft flex gap-2">
        <ActionBtn
          icon="phone"
          onClick={() => { copyPhoneOnly().catch((err) => alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')) }}
          primary
          disabled={!lead.phone}
        />
        <ActionBtn icon="calendar" onClick={() => setActive('rdv')} />
        <ActionBtn icon="edit" onClick={() => setActive('notes')} />
      </div>
      {/* Tabs */}
      <div className="flex items-center justify-center gap-2 px-5 py-3 bg-or-tint border-b border-line-soft overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`w-10 h-10 rounded-full flex flex-shrink-0 items-center justify-center transition-colors ${active === t.id ? 'bg-or text-white shadow-sm' : 'bg-white/70 text-muted hover:bg-white hover:text-text'}`}
            title={t.label}
            aria-label={t.label}
          >
            <Icon name={t.icon ?? iconForTab(t.id)} size={16} />
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-grow overflow-y-auto p-5 text-sm">
        {children
          ? children(active)
          : (
            <DefaultPanelContent
              lead={lead}
              userMap={userMap}
              active={active}
              isActiveCallForThisLead={isActiveCallForThisLead}
              callState={callState}
              onSaved={onSaved}
            />
          )}
      </div>
    </aside>
  )
}

function iconForTab(id: string): IconName {
  switch (id) {
    case 'infos': return 'eye'
    case 'activite': return 'clock'
    case 'appels': return 'phone'
    case 'rdv': return 'calendar'
    case 'notes': return 'edit'
    default: return 'grid'
  }
}

function ActionBtn({ icon, onClick, primary = false, disabled = false }: { icon: IconName; onClick?: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        primary ? 'bg-or text-white hover:opacity-90' : 'bg-or-tint text-text hover:bg-cream'
      }`}
    >
      <Icon name={icon} size={16} />
    </button>
  )
}

function DefaultPanelContent({
  lead,
  userMap,
  active,
  isActiveCallForThisLead,
  callState,
  onSaved,
}: {
  lead: LeadResponse
  userMap?: Map<string, UserResponse>
  active: string
  isActiveCallForThisLead: boolean
  callState: CallState
  onSaved?: () => void
}) {
  if (active === 'infos') return <InfosTab lead={lead} userMap={userMap} onSaved={onSaved} />
  if (active === 'activite') return <ActiviteTab leadId={lead.id} userMap={userMap} />
  if (active === 'appels') return <AppelsTab leadId={lead.id} userMap={userMap} />
  if (active === 'rdv') return <RdvTab lead={lead} userMap={userMap} />
  if (active === 'notes') {
    return (
      <NotesTab
        lead={lead}
        isActiveCall={isActiveCallForThisLead}
        result={callState.result}
        notes={callState.notes}
        setResult={callState.setResult}
        setNotes={callState.setNotes}
        onSaved={onSaved}
      />
    )
  }
  return null
}

type InfosEditable = {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressLine: string
  city: string
  postalCode: string
  status: LeadResponse['status']
}

function leadToInfosForm(lead: LeadResponse): InfosEditable {
  return {
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    addressLine: lead.addressLine ?? '',
    city: lead.city ?? '',
    postalCode: lead.postalCode ?? '',
    status: lead.status,
  }
}

function InfosTab({ lead, userMap, onSaved }: { lead: LeadResponse; userMap?: Map<string, UserResponse>; onSaved?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<InfosEditable>(() => leadToInfosForm(lead))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setForm(leadToInfosForm(lead))
  }, [lead, editing])

  // Setters multi : union de setterId (principal) + assignedSetterIds (collègues qui se sont auto-assignés).
  const setterIdSet = new Set<string>()
  if (lead.setterId) setterIdSet.add(lead.setterId)
  for (const id of lead.assignedSetterIds ?? []) setterIdSet.add(id)
  const setterNames = Array.from(setterIdSet)
    .map((id) => userMap?.get(id)?.name)
    .filter((n): n is string => Boolean(n))
  const commercial = lead.assignedToId ? userMap?.get(lead.assignedToId)?.name : null

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = {}
      const initial = leadToInfosForm(lead)
      for (const key of Object.keys(form) as (keyof InfosEditable)[]) {
        if (form[key] !== initial[key]) {
          if (key !== 'status') {
            // Champs texte : on envoie null si vide pour que le back nettoie la valeur.
            const trimmed = (form[key] as string).trim()
            patch[key] = trimmed === '' ? null : trimmed
          } else {
            patch[key] = form[key]
          }
        }
      }
      if (Object.keys(patch).length === 0) {
        setEditing(false)
        return
      }
      await updateLead(lead.id, patch as Parameters<typeof updateLead>[1])
      onSaved?.()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-or hover:underline inline-flex items-center gap-1"
          >
            <Icon name="edit" size={12} /> Modifier
          </button>
        </div>
        <Field label="NOM" value={[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'} />
        <Field label="TÉLÉPHONE" value={lead.phone ?? '—'} />
        <Field label="EMAIL" value={lead.email ?? '—'} />
        <Field label="ADRESSE" value={[lead.addressLine, lead.postalCode, lead.city].filter(Boolean).join(', ') || '—'} />
        <Field label="VILLE" value={lead.city ?? '—'} />
        <Field label="SOURCE" value={prettySource(lead)} />
        {lead.utmSource && <Field label="UTM" value={lead.utmSource} />}
        <Field label="STATUT" value={STATUS_LABEL[lead.status]} />
        {setterNames.length > 0 && (
          <Field label={setterNames.length > 1 ? `SETTERS (${setterNames.length})` : 'SETTER'} value={setterNames.join(' · ')} />
        )}
        {commercial && <Field label="COMMERCIAL" value={commercial} />}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <button
          onClick={() => { setEditing(false); setError(null) }}
          disabled={saving}
          className="text-xs font-semibold text-faint hover:underline disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="text-xs font-semibold text-or hover:underline disabled:opacity-50"
        >
          {saving ? <Spinner size={14} stroke={2} label="Enregistrement…" /> : 'Enregistrer'}
        </button>
      </div>
      {error && <div className="text-xs text-rouille bg-rouille-tint/40 rounded p-2">{error}</div>}
      <EditableField label="PRÉNOM" value={form.firstName} onChange={(v) => setForm((f) => ({ ...f, firstName: v }))} />
      <EditableField label="NOM" value={form.lastName} onChange={(v) => setForm((f) => ({ ...f, lastName: v }))} />
      <EditableField label="TÉLÉPHONE" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="+262 692 ..." />
      <EditableField label="EMAIL" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />
      <EditableField label="ADRESSE" value={form.addressLine} onChange={(v) => setForm((f) => ({ ...f, addressLine: v }))} />
      <EditableField label="CODE POSTAL" value={form.postalCode} onChange={(v) => setForm((f) => ({ ...f, postalCode: v }))} placeholder="97400" />
      <EditableField label="VILLE" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} />
      <div>
        <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">STATUT</div>
        <select
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as LeadResponse['status'] }))}
          className="w-full bg-white border border-line rounded px-2 py-1.5 text-sm"
        >
          {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <Field label="SOURCE" value={`${prettySource(lead)} · non modifiable`} />
      {setterNames.length > 0 && (
        <Field label={setterNames.length > 1 ? `SETTERS (${setterNames.length})` : 'SETTER'} value={setterNames.join(' · ')} />
      )}
      {commercial && <Field label="COMMERCIAL" value={commercial} />}
    </div>
  )
}

function EditableField({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-line rounded px-2 py-1.5 text-sm"
      />
    </div>
  )
}

function ActiviteTab({ leadId, userMap }: { leadId: string; userMap?: Map<string, UserResponse> }) {
  const { data: calls, loading: cLoading } = useCallLogs({ leadId, limit: 20 })
  const { data: rdvs, loading: rLoading } = useRdvList({ leadId, limit: 20 })

  if (cLoading || rLoading) return <LoadingBlock />

  type Item = { ts: string; node: ReactNode }
  const items: Item[] = []
  for (const c of calls ?? []) {
    items.push({
      ts: c.calledAt,
      node: (
        <TimelineRow
          key={`call-${c.id}`}
          icon="phone"
          title={`Appel — ${CALL_RESULT_LABEL[c.result]}`}
          subtitle={c.notes ?? userMap?.get(c.setterId)?.name ?? null}
          ts={c.calledAt}
        />
      ),
    })
  }
  for (const r of rdvs ?? []) {
    items.push({
      ts: r.scheduledAt,
      node: (
        <TimelineRow
          key={`rdv-${r.id}`}
          icon="calendar"
          title={`RDV ${r.locationType} — ${r.status}`}
          subtitle={r.result ? `Résultat: ${r.result}` : null}
          ts={r.scheduledAt}
        />
      ),
    })
  }
  items.sort((a, b) => (a.ts < b.ts ? 1 : -1))

  if (items.length === 0) return <p className="text-faint">Aucune activité.</p>
  return <div className="space-y-3">{items.slice(0, 15).map((i) => i.node)}</div>
}

function AppelsTab({ leadId, userMap }: { leadId: string; userMap?: Map<string, UserResponse> }) {
  const { data, loading } = useCallLogs({ leadId, limit: 50 })
  if (loading) return <LoadingBlock />

  if (!data || data.length === 0) return <p className="text-faint">Aucun appel pour ce lead.</p>
  return (
    <div className="space-y-3">
      {data.map((c) => (
        <div key={c.id} className="bg-white/60 border border-line rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-or">{CALL_RESULT_LABEL[c.result]}</span>
            <span className="text-[11px] text-faint">{formatDate(c.calledAt)}</span>
          </div>
          {userMap?.get(c.setterId)?.name && (
            <div className="text-xs text-muted">{userMap.get(c.setterId)?.name}</div>
          )}
          {c.notes && <p className="text-sm mt-2 text-text whitespace-pre-line">{c.notes}</p>}
        </div>
      ))}
    </div>
  )
}

function RdvTab({ lead, userMap }: { lead: LeadResponse; userMap?: Map<string, UserResponse> }) {
  const { data, loading } = useRdvList({ leadId: lead.id, limit: 50 })
  if (loading) return <LoadingBlock />

  const callbackCard = lead.nextCallbackAt ? <CallbackCard nextCallbackAt={lead.nextCallbackAt} /> : null
  if (!data || data.length === 0) {
    if (callbackCard) return <div className="space-y-3">{callbackCard}</div>
    return <p className="text-faint">Aucun RDV pour ce lead.</p>
  }
  return (
    <div className="space-y-3">
      {callbackCard}
      {data.map((r) => (
        <div key={r.id} className="bg-white/60 border border-line rounded-xl p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-or">{r.status}</span>
            <span className="text-[11px] text-faint">{formatDate(r.scheduledAt)}</span>
          </div>
          <div className="text-xs text-muted">
            {r.locationType}
            {r.commercialId && userMap?.get(r.commercialId)?.name ? ` · ${userMap.get(r.commercialId)?.name}` : ''}
          </div>
          {r.result && <div className="text-xs text-text mt-1">Résultat : <span className="font-semibold">{r.result}</span></div>}
          {r.notes && <p className="text-sm mt-2 text-text whitespace-pre-line">{r.notes}</p>}
        </div>
      ))}
    </div>
  )
}

function CallbackCard({ nextCallbackAt }: { nextCallbackAt: string }) {
  const dueAt = new Date(nextCallbackAt).getTime()
  const overdue = dueAt <= Date.now()
  const label = overdue ? 'Rappel en retard' : 'Rappel programmé'
  const tone = overdue ? 'text-rouille' : 'text-cuivre'
  const bg = overdue ? 'bg-rouille-tint/40' : 'bg-cuivre-tint/40'
  return (
    <div className={`${bg} border border-line rounded-xl p-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[11px] font-bold uppercase tracking-widest ${tone}`}>{label}</span>
        <span className="text-[11px] text-faint">Téléphone</span>
      </div>
      <div className="text-sm font-semibold text-text">{formatCallbackDate(nextCallbackAt)}</div>
    </div>
  )
}

function formatCallbackDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const datePart = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const timePart = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${datePart[0].toUpperCase()}${datePart.slice(1)} à ${timePart}`
}

function NotesTab({
  lead,
  isActiveCall,
  result,
  notes,
  setResult,
  setNotes,
  onSaved,
}: {
  lead: LeadResponse
  isActiveCall: boolean
  result: CallResult | ''
  notes: string
  setResult: (r: CallResult | '') => void
  setNotes: (n: string) => void
  onSaved?: () => void
}) {
  type SetterStatus = '' | 'non_qualifie' | 'a_rappeler' | 'pas_de_reponse' | 'qualifie'
  type Step = 'eligibility' | 'qualification' | 'secteur' | 'rdv' | 'confirmation' | 'done'

  const [setterStatus, setSetterStatus] = useState<SetterStatus>(() => statusToSetterStatus(lead.status))
  const [step, setStep] = useState<Step>('eligibility')
  const [eligibilityNotes, setEligibilityNotes] = useState<EligibilityNotes>(EMPTY_ELIGIBILITY_NOTES)
  const [commentaire, setCommentaire] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [sector, setSector] = useState<'Nord' | 'Sud' | 'Est' | 'Ouest' | ''>('')
  const [rdvAt, setRdvAt] = useState('')
  const [form, setForm] = useState({
    firstName: lead.firstName ?? '',
    lastName: lead.lastName ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    addressLine: lead.addressLine ?? '',
    city: lead.city ?? '',
    postalCode: lead.postalCode ?? '',
    typeLogement: lead.typeLogement ?? '',
    revenuFiscal: lead.revenuFiscal?.toString() ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const agendaDate = rdvAt ? rdvAt.split('T')[0] : todayInputValue()
  const agendaPeriod = useMemo(() => dayPeriodFromInput(agendaDate), [agendaDate])
  const { data: agendaRdvs, loading: agendaLoading, refetch: refetchAgenda } = useRdvList({
    fromDate: agendaPeriod.from.toISOString(),
    toDate: agendaPeriod.to.toISOString(),
    limit: 80,
  })
  void notes
  void setNotes

  // Restaure le workflow en cours depuis localStorage (par lead.id) — survit aux
  // remounts (PersistentLeadSidebar peut se démonter brièvement quand useLead
  // refetch, F5, déconnexion WS, etc.) sans faire perdre la saisie en cours.
  useEffect(() => {
    const defaultForm = {
      firstName: lead.firstName ?? '',
      lastName: lead.lastName ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      addressLine: lead.addressLine ?? '',
      city: lead.city ?? '',
      postalCode: lead.postalCode ?? '',
      typeLogement: lead.typeLogement ?? '',
      revenuFiscal: lead.revenuFiscal?.toString() ?? '',
    }
    try {
      const stored = localStorage.getItem(notesTabStorageKey(lead.id))
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<{
          setterStatus: SetterStatus
          step: Step
          eligibilityNotes: EligibilityNotes
          commentaire: string
          callbackAt: string
          sector: '' | 'Nord' | 'Sud' | 'Est' | 'Ouest'
          rdvAt: string
          form: typeof defaultForm
        }>
        setSetterStatus(parsed.setterStatus ?? statusToSetterStatus(lead.status))
        setStep(parsed.step ?? 'eligibility')
        setEligibilityNotes(parsed.eligibilityNotes ?? EMPTY_ELIGIBILITY_NOTES)
        setCommentaire(parsed.commentaire ?? '')
        setCallbackAt(parsed.callbackAt ?? '')
        setSector(parsed.sector ?? '')
        setRdvAt(parsed.rdvAt ?? '')
        setForm({ ...defaultForm, ...(parsed.form ?? {}) })
        setError(null)
        setSuccess(null)
        return
      }
    } catch {}
    setSetterStatus(statusToSetterStatus(lead.status))
    setStep('eligibility')
    setEligibilityNotes(EMPTY_ELIGIBILITY_NOTES)
    setCommentaire('')
    setCallbackAt('')
    setSector('')
    setRdvAt('')
    setForm(defaultForm)
    setError(null)
    setSuccess(null)
  }, [lead.id])

  // Sauvegarde à chaque modification (debounced via React batching) — clé par lead.
  useEffect(() => {
    if (step === 'done') return // workflow terminé, on ne persiste plus
    try {
      localStorage.setItem(notesTabStorageKey(lead.id), JSON.stringify({
        setterStatus, step, eligibilityNotes, commentaire, callbackAt, sector, rdvAt, form,
      }))
    } catch {}
  }, [lead.id, setterStatus, step, eligibilityNotes, commentaire, callbackAt, sector, rdvAt, form])

  // Workflow validé : on nettoie le brouillon pour que la prochaine visite reparte propre.
  useEffect(() => {
    if (step === 'done') {
      try { localStorage.removeItem(notesTabStorageKey(lead.id)) } catch {}
    }
  }, [step, lead.id])

  const eligibilitySummary = formatEligibilityNotes(eligibilityNotes)
  const noteFinale = [eligibilitySummary, commentaire.trim()].filter(Boolean).join('\n\n') || null
  const rdvTransferNote = formatRdvTransferNote({
    lead,
    form,
    sector,
    callNote: noteFinale,
  })

  async function saveCallAndLead(kind: Exclude<SetterStatus, ''>) {
    setError(null)
    setSaving(true)
    try {
      if (kind === 'non_qualifie') {
        if (!commentaire.trim()) throw new Error('Ajoute un commentaire pour expliquer pourquoi le lead est non qualifié.')
        await createCallLog({ leadId: lead.id, result: 'refus', notes: noteFinale })
        await updateLead(lead.id, { status: 'pas_qualifie' })
        setResult('')
        setSuccess('Lead marqué non qualifié.')
        setStep('done')
      } else if (kind === 'pas_de_reponse') {
        await createCallLog({ leadId: lead.id, result: 'non_joint', notes: noteFinale || null })
        await updateLead(lead.id, { status: 'pas_de_reponse' })
        setResult('')
        setSuccess('Lead marqué en pas de réponse.')
        setStep('done')
      } else if (kind === 'a_rappeler') {
        if (!callbackAt) throw new Error('Choisis la date et l’heure du rappel.')
        await createCallLog({ leadId: lead.id, result: 'rappel_planifie', nextCallbackAt: new Date(callbackAt).toISOString(), notes: noteFinale || null })
        await updateLead(lead.id, { status: 'a_rappeler', datePassageRelance: new Date(callbackAt).toISOString() })
        setResult('')
        setSuccess('Rappel planifié et lead passé en À rappeler.')
        setStep('done')
      } else {
        if (!commentaire.trim()) throw new Error('Ajoute un commentaire principal.')
        setResult('')
        setSuccess(null)
        setStep('secteur')
      }
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action impossible')
    } finally {
      setSaving(false)
    }
  }

  async function validateRdv() {
    setError(null)
    setSaving(true)
    try {
      if (!sector) throw new Error('Sélectionne un secteur.')
      if (!rdvAt) throw new Error('Choisis une date de rendez-vous.')
      const revenu = form.revenuFiscal.trim() ? Number(form.revenuFiscal) : null
      if (revenu !== null && Number.isNaN(revenu)) throw new Error('Le revenu fiscal doit être un nombre.')
      await updateLead(lead.id, {
        status: 'qualifie',
        firstName: form.firstName || null,
        lastName: form.lastName || null,
        email: form.email || null,
        phone: form.phone || null,
        addressLine: form.addressLine || null,
        city: form.city || null,
        postalCode: form.postalCode || null,
        typeLogement: form.typeLogement || null,
        revenuFiscal: revenu,
      })
      await createRdv({
        leadId: lead.id,
        commercialId: null,
        scheduledAt: new Date(rdvAt).toISOString(),
        locationType: 'domicile',
        notes: rdvTransferNote,
      })
      await createCallLog({ leadId: lead.id, result: 'joint', notes: noteFinale || null })
      refetchAgenda()
      setSuccess('RDV créé, agenda mis à jour et lead qualifié. Les infos envoyées incluent email, nom complet, numéro et note d’appel.')
      setStep('done')
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation impossible')
    } finally {
      setSaving(false)
    }
  }

  function updateEligibility<K extends keyof EligibilityNotes>(key: K, value: EligibilityNotes[K]) {
    setEligibilityNotes((current) => ({ ...current, [key]: value }))
  }

  function continueToQualification() {
    setError(null)
    if (!eligibilityNotes.isOwner) return setError('Indique si la personne est propriétaire.')
    if (!eligibilityNotes.activity) return setError('Indique si la personne est en activité ou retraitée.')
    if (eligibilityNotes.activity === 'retraite' && !eligibilityNotes.age.trim()) return setError('Renseigne l’âge pour une personne retraitée.')
    if (!eligibilityNotes.projectTiming.trim()) return setError('Indique si le projet est rapide ou informatif.')
    if (!eligibilityNotes.monthlyBill.trim()) return setError('Renseigne le montant approximatif des factures mensuelles.')
    if (!eligibilityNotes.firstInfo) return setError('Indique si c’est le premier renseignement sur le projet.')
    if (!eligibilityNotes.wantsBattery) return setError('Indique si la personne souhaite une batterie / autonomie.')
    if (!eligibilityNotes.hasBudget) return setError('Indique si la personne a déjà pensé à un budget.')
    setSetterStatus('')
    setResult('')
    setStep('qualification')
  }

  return (
    <div className="space-y-5">
      <Stepper current={step} />
      <div className="rounded-xl border border-line bg-white/70 px-3 py-2 text-sm flex items-center justify-between gap-3">
        <span className="text-faint">Statut actuel</span>
        <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
      </div>
      {error && <div className="rounded-xl border border-rouille/30 bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
      {success && <div className="rounded-xl border border-success/30 bg-success-tint px-3 py-2 text-sm text-success">{success}</div>}

      {step === 'eligibility' && (
        <div className="space-y-4">
          <div className="rounded-[18px] border border-line bg-white/70 p-4 space-y-4">
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">Notes d’éligibilité</div>
              <p className="text-sm text-muted">À remplir pendant l’appel avant de décider si le lead est qualifié, à rappeler ou non qualifié.</p>
            </div>

            <YesNoField
              label="Est-ce que vous êtes bien propriétaire de la maison ?"
              value={eligibilityNotes.isOwner}
              onChange={(value) => updateEligibility('isOwner', value)}
            />

            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">Êtes-vous en activité ou retraité ?</div>
              <div className="grid grid-cols-2 gap-2">
                <ChoicePill active={eligibilityNotes.activity === 'actif'} onClick={() => updateEligibility('activity', 'actif')}>En activité</ChoicePill>
                <ChoicePill active={eligibilityNotes.activity === 'retraite'} onClick={() => updateEligibility('activity', 'retraite')}>Retraité</ChoicePill>
              </div>
              {eligibilityNotes.activity === 'retraite' && (
                <div className="mt-2">
                  <Input label="Si ce n’est pas trop indiscret, vous avez quel âge ?" type="number" value={eligibilityNotes.age} onChange={(value) => updateEligibility('age', value)} />
                </div>
              )}
            </div>

            <Input label="Projet rapidement ou juste à titre informatif ?" value={eligibilityNotes.projectTiming} onChange={(value) => updateEligibility('projectTiming', value)} />
            <Input label="Factures d’électricité chaque mois (€ environ)" type="number" value={eligibilityNotes.monthlyBill} onChange={(value) => updateEligibility('monthlyBill', value)} />

            <YesNoField
              label="Est-ce qu’il s’agit de votre premier renseignement sur le projet ?"
              value={eligibilityNotes.firstInfo}
              onChange={(value) => updateEligibility('firstInfo', value)}
            />

            <YesNoField
              label="Souhaitez-vous devenir autonome avec une batterie pour stocker l’énergie ?"
              value={eligibilityNotes.wantsBattery}
              onChange={(value) => updateEligibility('wantsBattery', value)}
            />
            <textarea
              value={eligibilityNotes.batteryNote}
              onChange={(e) => updateEligibility('batteryNote', e.target.value)}
              placeholder="Petite note sur l’autonomie / batterie…"
              className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-20 resize-none"
            />

            <YesNoField
              label="Avez-vous déjà pensé à un budget à allouer au projet ?"
              value={eligibilityNotes.hasBudget}
              onChange={(value) => updateEligibility('hasBudget', value)}
            />
            <textarea
              value={eligibilityNotes.budgetNote}
              onChange={(e) => updateEligibility('budgetNote', e.target.value)}
              placeholder="Petite note sur le budget envisagé…"
              className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-20 resize-none"
            />

            <div className="rounded-[18px] border border-line bg-white/80 p-3 space-y-3">
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">Si le lead ne peut pas répondre</div>
                <p className="text-xs text-muted">Enregistre directement le statut depuis les notes.</p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <StatusChoice active={setterStatus === 'a_rappeler'} icon="clock" title="À rappeler" text="Date et heure du rappel" onClick={() => { setSetterStatus('a_rappeler'); setResult('rappel_planifie') }} />
                <StatusChoice active={setterStatus === 'pas_de_reponse'} icon="phone-off" title="Pas de réponse" text="Aucun champ requis" onClick={() => { setSetterStatus('pas_de_reponse'); setResult('non_joint') }} />
              </div>
              {setterStatus === 'a_rappeler' && (
                <div className="space-y-3">
                  <DateTimeSlotInput label="Date et heure du rappel" value={callbackAt} onChange={setCallbackAt} />
                  <textarea
                    value={commentaire}
                    onChange={(e) => setCommentaire(e.target.value)}
                    placeholder="Commentaire rappel : disponibilité, contexte…"
                    className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-20 resize-none"
                  />
                </div>
              )}
              {setterStatus === 'pas_de_reponse' && (
                <p className="text-sm text-muted">Aucun champ obligatoire : tu peux enregistrer directement.</p>
              )}
              {(setterStatus === 'a_rappeler' || setterStatus === 'pas_de_reponse') && (
                <button
                  type="button"
                  onClick={() => saveCallAndLead(setterStatus)}
                  disabled={saving}
                  className="btn-primary w-full rounded-xl py-2 text-sm disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? <Spinner size={16} stroke={2} /> : null}
                  Enregistrer le statut
                </button>
              )}
            </div>

            <button type="button" onClick={continueToQualification} className="btn-primary w-full rounded-xl py-2 text-sm">
              Continuer vers qualification
            </button>
          </div>
        </div>
      )}

      {step === 'qualification' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep('eligibility')}
            className="rounded-xl border border-line bg-white/70 px-3 py-2 text-sm font-semibold hover:bg-white"
          >
            Retour vers notes
          </button>

          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-2">Statut setter</div>
            <div className="grid grid-cols-1 gap-2">
              <StatusChoice active={setterStatus === 'non_qualifie'} icon="x" title="Pas qualifié" text="Commentaire obligatoire" onClick={() => { setSetterStatus('non_qualifie'); setResult('refus') }} />
              <StatusChoice active={setterStatus === 'qualifie'} icon="check" title="Qualifié" text="Commentaire principal, secteur et RDV" onClick={() => { setSetterStatus('qualifie'); setResult('joint') }} />
            </div>
          </div>

          {(setterStatus === 'non_qualifie' || setterStatus === 'qualifie') && (
            <div className="rounded-[18px] border border-line bg-white/70 p-4 space-y-3">
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder={setterStatus === 'non_qualifie' ? 'Commentaire obligatoire : pourquoi pas qualifié ?' : 'Commentaire obligatoire : besoins, contexte, objections…'}
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
                autoFocus={isActiveCall}
              />
              {setterStatus === 'qualifie' && (
                <p className="text-sm text-muted">Valide la qualification pour passer à la sélection du secteur puis au RDV.</p>
              )}
              <button
                onClick={() => saveCallAndLead(setterStatus)}
                disabled={saving}
                className="btn-primary w-full rounded-xl py-2 text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size={16} stroke={2} /> : null}
                {setterStatus === 'qualifie' ? 'Continuer vers secteur' : 'Enregistrer le statut'}
              </button>
            </div>
          )}

          <div className="border-t border-line-soft pt-3">
            <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-2">Résultat rapide existant</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_RESULTS.map((r) => (
                <button key={r} onClick={() => setResult(result === r ? '' : r)} className={`pill-tab text-xs ${result === r ? 'active' : ''}`}>{CALL_RESULT_LABEL[r]}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'secteur' && (
        <div className="space-y-4">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Secteur de l’adresse client</div>
          <div className="grid grid-cols-2 gap-2">
            {(['Nord', 'Sud', 'Est', 'Ouest'] as const).map((s) => (
              <button key={s} onClick={() => { setSector(s); setStep('rdv') }} className={`rounded-[18px] border p-4 text-left ${sector === s ? 'border-or bg-or-tint text-or-dark' : 'border-line bg-white/70 hover:bg-white'}`}>
                <Icon name="map-pin" size={16} />
                <div className="font-bold mt-2">{s}</div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setStep('qualification')} className="rounded-xl border border-line bg-white/70 py-2 text-sm font-semibold hover:bg-white">Retour</button>
            <button onClick={() => setStep('rdv')} disabled={!sector} className="btn-primary rounded-xl py-2 text-sm disabled:opacity-50">Next · calendrier</button>
          </div>
        </div>
      )}

      {step === 'rdv' && (
        <div className="space-y-4">
          <div className="rounded-[18px] border border-or/20 bg-or-tint p-3">
            <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark mb-1">Secteur sélectionné</div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-or-dark">{sector}</span>
              <button type="button" onClick={() => setStep('secteur')} className="text-xs font-semibold text-or hover:underline">Changer</button>
            </div>
          </div>
          <DateTimeSlotInput label="Date et heure du RDV commercial" value={rdvAt} onChange={setRdvAt} timeSlots={COMMERCIAL_RDV_TIME_SLOTS} />
          <InlineRdvAgenda
            selectedAt={rdvAt}
            rdvs={agendaRdvs ?? []}
            loading={agendaLoading}
            leadId={lead.id}
          />
          <p className="text-xs text-muted">Créneaux en heures pleines uniquement. L’agenda se met à jour directement ici, sans quitter le tableau des leads. Le commercial sera attribué automatiquement par GHL.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setStep('secteur')} className="rounded-xl border border-line bg-white/70 py-2 text-sm font-semibold hover:bg-white">Retour</button>
            <button onClick={() => setStep('confirmation')} disabled={!rdvAt} className="btn-primary rounded-xl py-2 text-sm disabled:opacity-50">Next · formulaire lead</button>
          </div>
        </div>
      )}

      {step === 'confirmation' && (
        <div className="space-y-3">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Vérifier / compléter la fiche lead</div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Prénom" value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} />
            <Input label="Nom" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} />
          </div>
          <Input label="Téléphone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Adresse" value={form.addressLine} onChange={(v) => setForm({ ...form, addressLine: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Ville" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <Input label="Code postal" value={form.postalCode} onChange={(v) => setForm({ ...form, postalCode: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Type logement" value={form.typeLogement} onChange={(v) => setForm({ ...form, typeLogement: v })} />
            <Input label="Revenu fiscal" value={form.revenuFiscal} onChange={(v) => setForm({ ...form, revenuFiscal: v })} />
          </div>
          <div className="rounded-[18px] border border-or/20 bg-or-tint p-4 space-y-2">
            <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark">Résumé final avant validation</div>
            <Field label="LEAD" value={`${form.firstName} ${form.lastName}`.trim() || fullName(lead)} />
            <Field label="STATUT" value="Qualifié" />
            <Field label="EMAIL" value={(form.email || lead.email) ?? '—'} />
            <Field label="TÉLÉPHONE" value={(form.phone || lead.phone) ?? '—'} />
            <Field label="NOTES D’APPEL ENVOYÉES" value={noteFinale || '—'} />
            <Field label="SECTEUR" value={sector || '—'} />
            <Field label="RDV" value={rdvAt ? formatDate(new Date(rdvAt).toISOString()) : '—'} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setStep('rdv')} className="rounded-xl border border-line bg-white/70 py-2 text-sm font-semibold hover:bg-white">Retour</button>
            <button onClick={validateRdv} disabled={saving} className="btn-primary rounded-xl py-2 text-sm disabled:opacity-60 flex items-center justify-center gap-2">{saving ? <Spinner size={16} stroke={2} /> : null}Valider définitivement</button>
          </div>
        </div>
      )}
    </div>
  )
}

function InlineRdvAgenda({
  selectedAt,
  rdvs,
  loading,
  leadId,
}: {
  selectedAt: string
  rdvs: RdvResponse[]
  loading: boolean
  leadId: string
}) {
  const selectedTime = selectedAt ? selectedAt.split('T')[1] : ''
  const planned = rdvs.filter((r) => r.status === 'planifie')
  const byTime = new Map<string, RdvResponse[]>()
  for (const r of planned) {
    const slot = new Date(r.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const list = byTime.get(slot) ?? []
    list.push(r)
    byTime.set(slot, list)
  }

  return (
    <div className="rounded-[18px] border border-line bg-white/70 overflow-hidden">
      <div className="px-3 py-2 border-b border-line-soft flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Agenda du jour</div>
          <div className="text-xs text-muted">{planned.length} RDV planifié{planned.length > 1 ? 's' : ''}</div>
        </div>
        {loading && <Spinner size={14} stroke={2} label="Agenda…" />}
      </div>
      <div className="divide-y divide-line-soft max-h-64 overflow-y-auto">
        {COMMERCIAL_RDV_TIME_SLOTS.map((slot) => {
          const slotLabel = slot
          const matches = byTime.get(slotLabel) ?? []
          const selected = selectedTime === slot
          const busy = matches.length > 0
          return (
            <div key={slot} className={`px-3 py-2 flex items-start gap-3 ${selected ? 'bg-or-tint' : busy ? 'bg-white/80' : 'bg-white/40'}`}>
              <div className={`w-14 text-xs font-bold ${selected ? 'text-or-dark' : 'text-muted'}`}>{slotLabel}</div>
              <div className="flex-grow min-w-0">
                {busy ? matches.map((r) => (
                  <div key={r.id} className={`text-xs ${r.leadId === leadId ? 'font-bold text-or-dark' : 'text-text'}`}>
                    {r.leadId === leadId ? 'Ce lead' : 'RDV déjà pris'} · {r.locationType}
                  </div>
                )) : (
                  <div className="text-xs text-faint">Disponible</div>
                )}
              </div>
              {selected && <span className="status-badge bg-or text-white">Choisi</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stepper({ current }: { current: string }) {
  const steps = [
    ['eligibility', 'Notes'],
    ['qualification', 'Qualification'],
    ['secteur', 'Secteur'],
    ['rdv', 'Calendrier'],
    ['confirmation', 'Formulaire'],
  ]
  const idx = Math.max(0, steps.findIndex(([id]) => id === current))
  return (
    <div className="grid grid-cols-5 gap-1">
      {steps.map(([id, label], i) => (
        <div key={id} className={`rounded-full px-2 py-1 text-[10px] text-center font-bold ${i <= idx ? 'bg-or text-white' : 'bg-or-tint text-muted'}`}>{label}</div>
      ))}
    </div>
  )
}

function StatusChoice({ active, icon, title, text, onClick }: { active: boolean; icon: IconName; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-[18px] border p-3 text-left flex gap-3 ${active ? 'border-or bg-or-tint' : 'border-line bg-white/70 hover:bg-white'}`}>
      <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-or"><Icon name={icon} size={15} /></div>
      <div>
        <div className="font-bold text-sm">{title}</div>
        <div className="text-xs text-muted">{text}</div>
      </div>
    </button>
  )
}

function YesNoField({ label, value, onChange }: { label: string; value: YesNo; onChange: (value: YesNo) => void }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <ChoicePill active={value === 'oui'} onClick={() => onChange('oui')}>Oui</ChoicePill>
        <ChoicePill active={value === 'non'} onClick={() => onChange('non')}>Non</ChoicePill>
      </div>
    </div>
  )
}

function ChoicePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[14px] border px-3 py-2 text-sm font-semibold ${active ? 'border-or bg-or-tint text-or-dark' : 'border-line bg-white/70 hover:bg-white text-muted'}`}>
      {children}
    </button>
  )
}

function formatRdvTransferNote({
  lead,
  form,
  sector,
  callNote,
}: {
  lead: LeadResponse
  form: {
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  sector: string
  callNote: string | null
}): string {
  const name = `${form.firstName} ${form.lastName}`.trim() || fullName(lead)
  const email = form.email.trim() || lead.email || '—'
  const phone = form.phone.trim() || lead.phone || '—'
  return [
    'Transmission RDV commercial',
    `Nom complet du lead : ${name}`,
    `Email : ${email}`,
    `Numéro : ${phone}`,
    sector ? `Secteur : ${sector}` : null,
    callNote ? `Note de l’appel :\n${callNote}` : 'Note de l’appel : —',
  ].filter(Boolean).join('\n')
}

function formatEligibilityNotes(notes: EligibilityNotes): string {
  const lines = [
    notes.isOwner && `Propriétaire maison : ${yesNoLabel(notes.isOwner)}`,
    notes.activity && `Situation : ${notes.activity === 'retraite' ? `Retraité${notes.age.trim() ? ` · âge ${notes.age.trim()}` : ''}` : 'En activité'}`,
    notes.projectTiming.trim() && `Intention projet : ${notes.projectTiming.trim()}`,
    notes.monthlyBill.trim() && `Facture électricité mensuelle : ${notes.monthlyBill.trim()} € environ`,
    notes.firstInfo && `Premier renseignement : ${yesNoLabel(notes.firstInfo)}`,
    notes.wantsBattery && `Autonomie / batterie : ${yesNoLabel(notes.wantsBattery)}${notes.batteryNote.trim() ? ` · ${notes.batteryNote.trim()}` : ''}`,
    notes.hasBudget && `Budget déjà envisagé : ${yesNoLabel(notes.hasBudget)}${notes.budgetNote.trim() ? ` · ${notes.budgetNote.trim()}` : ''}`,
  ].filter(Boolean)

  return lines.length > 0 ? `Notes d’éligibilité setter\n${lines.join('\n')}` : ''
}

function yesNoLabel(value: YesNo): string {
  if (value === 'oui') return 'Oui'
  if (value === 'non') return 'Non'
  return '—'
}

const COMMERCIAL_RDV_TIME_SLOTS = Array.from({ length: 11 }, (_, i) => {
  const hours = 9 + i
  return `${String(hours).padStart(2, '0')}:00`
})

function todayInputValue(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function dayPeriodFromInput(value: string): { from: Date; to: Date } {
  const base = value ? new Date(`${value}T00:00:00`) : new Date()
  const from = new Date(base)
  from.setHours(0, 0, 0, 0)
  const to = new Date(base)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

function DateTimeSlotInput({
  label,
  value,
  onChange,
  timeSlots,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  timeSlots?: string[]
}) {
  const [valueDate = '', valueTime = ''] = value.split('T')
  const [date, setDate] = useState(valueDate)
  const [time, setTime] = useState(valueTime)

  useEffect(() => {
    setDate(valueDate)
    setTime(valueTime)
  }, [valueDate, valueTime])

  const setPart = (nextDate: string, nextTime: string) => {
    setDate(nextDate)
    setTime(nextTime)
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : '')
  }

  return (
    <label className="block">
      <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={date} onChange={(e) => setPart(e.target.value, time)} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full" />
        {timeSlots ? (
          <select value={time} onChange={(e) => setPart(date, e.target.value)} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full">
            <option value="">Heure…</option>
            {timeSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        ) : (
          <input
            type="time"
            step={60}
            value={time}
            onChange={(e) => setPart(date, e.target.value)}
            className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full"
          />
        )}
      </div>
    </label>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full" />
    </label>
  )
}

function TimelineRow({ icon, title, subtitle, ts }: { icon: IconName; title: string; subtitle: string | null; ts: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-or-tint flex items-center justify-center flex-shrink-0">
        <Icon name={icon} size={14} />
      </div>
      <div className="flex-grow min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
        <div className="text-[11px] text-faint">{formatDate(ts)}</div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-faint uppercase tracking-widest mb-1">{label}</div>
      <div className="text-sm font-medium whitespace-pre-line">{value}</div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusToSetterStatus(status: LeadResponse['status']): '' | 'non_qualifie' | 'a_rappeler' | 'pas_de_reponse' | 'qualifie' {
  if (status === 'pas_qualifie' || status === 'perdu') return 'non_qualifie'
  if (status === 'a_rappeler' || status === 'relance') return 'a_rappeler'
  if (status === 'pas_de_reponse') return 'pas_de_reponse'
  if (status === 'qualifie' || status === 'rdv_pris' || status === 'rdv_honore' || status === 'signe') return 'qualifie'
  return ''
}

function prettySource(l: Pick<LeadResponse, 'source' | 'canalAcquisition' | 'utmSource'>): string {
  if (l.canalAcquisition) return l.canalAcquisition
  if (l.utmSource) return l.utmSource[0].toUpperCase() + l.utmSource.slice(1)
  switch (l.source) {
    case 'ghl': return 'GHL'
    case 'airtable_migration': return 'Migration'
    case 'manual': return 'Manuel'
    case 'referrer': return 'Parrain'
  }
}
