import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import { Spinner, LoadingBlock } from './Spinner'
import {
  STATUS_LABEL,
  STATUS_BADGE,
  CALL_RESULT_LABEL,
  cleanField,
  fieldOrDash,
  fullName,
  initials as leadInitials,
  type CallResult,
  type LeadResponse,
  type RdvResponse,
  type UserResponse,
} from '../lib/types'
import { useCall, type CallState } from '../lib/call'
import { useCallLogs, useRdvList, useStartCall, createCallLog, createRdv, updateLead, updateGhlAppointment, useGhlCalendarConfig, useGhlFreeSlots, createGhlAppointment, syncLeadGhlCalendarEvents, type GhlCalendarEvent } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { leadDetailPath } from '../lib/leadPaths'
import { sectorFromCity } from '../lib/sector'

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

// Adresse complète sur 2 lignes max : ligne « rue », puis « code postal ville ».
// Lue directement depuis `lead`, donc se met à jour dès que l'onglet Infos enregistre (refetch via onSaved).
function fullAddressLines(lead: LeadResponse): string[] {
  const street = cleanField(lead.addressLine)
  const cityLine = [cleanField(lead.postalCode), cleanField(lead.city)].filter(Boolean).join(' ')
  return [street, cityLine || null].filter((line): line is string => Boolean(line))
}

export function SplitPanel({ lead, userMap, tabs = DEFAULT_TABS, defaultTab, children, onClose, onSaved, className }: SplitPanelProps) {
  const role = useAuth((s) => s.user?.role)
  const [active, setActive] = useState(defaultTab ?? tabs[0].id)
  const callState = useCall()
  const startCall = useStartCall()
  const isActiveCallForThisLead = callState.active && callState.leadId === lead.id

  const commercialName = lead.latestRdvCommercialId
    ? userMap?.get(lead.latestRdvCommercialId)?.name ?? null
    : null
  const addressLines = fullAddressLines(lead)

  return (
    <aside className={`w-full md:w-[420px] max-w-full border-l border-line bg-white/65 backdrop-blur-md flex flex-col flex-shrink-0 overflow-hidden ${className ?? ''}`}>
      {/* Header */}
      <div className="p-5 border-b border-line-soft flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-cuivre-tint flex items-center justify-center text-sm font-bold">{leadInitials(lead)}</div>
        <div className="flex-grow min-w-0">
          <div className="font-bold text-sm">{fullName(lead)}</div>
          <div className="text-xs text-faint truncate">{fieldOrDash(lead.phone)}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_BADGE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
            {lead.latestRdvAt && (
              <span className="status-badge bg-cream-darker text-text flex items-center gap-1">
                <Icon name="calendar" size={12} />
                {formatRdvDateTime(lead.latestRdvAt)}
              </span>
            )}
            {commercialName && (
              <span className="status-badge bg-cream-darker text-text flex items-center gap-1">
                <Icon name="users" size={12} />
                {commercialName}
              </span>
            )}
          </div>
        </div>
        {addressLines.length > 0 && (
          <div className="flex min-w-0 max-w-[45%] items-start justify-end gap-1 text-right">
            <Icon name="map-pin" size={12} className="mt-[2px] shrink-0 text-faint" />
            <div className="min-w-0 text-xs text-faint leading-snug">
              {addressLines.map((line, i) => (
                <div key={i} className="break-words">{line}</div>
              ))}
            </div>
          </div>
        )}
        {/* Bouton Appel : copie le numéro (Ringover manuel) et ouvre l'historique des appels. */}
        <button
          onClick={() => {
            if (!lead.phone) return
            startCall({ leadId: lead.id, leadName: fullName(lead), toNumber: lead.phone }).catch((err) => {
              console.error('Phone copy failed', err)
              alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')
            })
            if (tabs.some((t) => t.id === 'appels')) setActive('appels')
          }}
          disabled={!lead.phone}
          className="w-10 h-10 rounded-full bg-or text-white flex items-center justify-center shadow-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title={lead.phone ? 'Appeler (copie le numéro) + historique des appels' : 'Pas de numéro de téléphone'}
          aria-label="Appeler"
        >
          <Icon name="phone" size={14} />
        </button>
        <Link to={leadDetailPath(role, lead.id)} className="text-xs font-semibold text-or hover:underline whitespace-nowrap">
          Fiche →
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-cream flex items-center justify-center text-faint hover:text-text shrink-0"
            title="Réduire le panneau"
          >
            <Icon name="x" size={14} />
          </button>
        )}
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
  if (active === 'appels') return <AppelsTab lead={lead} userMap={userMap} />
  if (active === 'rdv') return <RdvTab lead={lead} userMap={userMap} onSaved={onSaved} />
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
  // DATA-1 défensif : si la BDD contient encore des "undefined" littéraux,
  // on les efface en chargeant le formulaire — sinon l'utilisateur sauverait
  // à nouveau "undefined" sans s'en rendre compte.
  return {
    firstName: cleanField(lead.firstName) ?? '',
    lastName: cleanField(lead.lastName) ?? '',
    email: cleanField(lead.email) ?? '',
    phone: cleanField(lead.phone) ?? '',
    addressLine: cleanField(lead.addressLine) ?? '',
    city: cleanField(lead.city) ?? '',
    postalCode: cleanField(lead.postalCode) ?? '',
    status: lead.status,
  }
}

// Champs lead éditables partagés entre l'onglet Notes (formulaire final avant envoi GHL)
// et l'onglet Infos. On les centralise pour pouvoir resynchroniser le formulaire Notes
// quand le lead est modifié ailleurs (ex : onglet Infos enregistre → refetch → prop lead change).
type LeadNotesForm = {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressLine: string
  city: string
  postalCode: string
}

function leadToNotesForm(lead: LeadResponse): LeadNotesForm {
  return {
    firstName: cleanField(lead.firstName) ?? '',
    lastName: cleanField(lead.lastName) ?? '',
    email: cleanField(lead.email) ?? '',
    phone: cleanField(lead.phone) ?? '',
    addressLine: cleanField(lead.addressLine) ?? '',
    city: cleanField(lead.city) ?? '',
    postalCode: cleanField(lead.postalCode) ?? '',
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
        if (form[key] === initial[key]) continue
        if (key === 'status') {
          patch.status = form.status
          continue
        }
        const trimmed = (form[key] as string).trim()
        patch[key] = trimmed === '' ? null : trimmed
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
        <Field label="PRÉNOM" value={fieldOrDash(lead.firstName)} />
        <Field label="NOM" value={fieldOrDash(lead.lastName)} />
        <Field label="TÉLÉPHONE" value={fieldOrDash(lead.phone)} />
        <Field label="EMAIL" value={fieldOrDash(lead.email)} />
        <Field label="ADRESSE" value={fieldOrDash(lead.addressLine)} />
        <Field label="CODE POSTAL" value={fieldOrDash(lead.postalCode)} />
        <Field label="VILLE" value={fieldOrDash(lead.city)} />
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

// Badge coloré par famille de résultat : qualifié (vert), à rappeler (cuivre),
// non qualifié / refus (rouille), sans réponse (gris).
const CALL_RESULT_BADGE: Record<CallResult, string> = {
  joint: 'bg-success-tint text-success',
  rdv_pris: 'bg-success-tint text-success',
  rappel_planifie: 'bg-cuivre-tint text-cuivre',
  refus: 'bg-rouille-tint text-rouille',
  non_joint: 'bg-muted/10 text-muted',
  injoignable: 'bg-muted/10 text-muted',
  messagerie: 'bg-muted/10 text-muted',
}

function AppelsTab({ lead, userMap }: { lead: LeadResponse; userMap?: Map<string, UserResponse> }) {
  const { data, loading } = useCallLogs({ leadId: lead.id, limit: 50 })

  // Setters multi : union de setterId (principal) + assignedSetterIds (collègues auto-assignés).
  const setterIdSet = new Set<string>()
  if (lead.setterId) setterIdSet.add(lead.setterId)
  for (const id of lead.assignedSetterIds ?? []) setterIdSet.add(id)
  const setterNames = Array.from(setterIdSet)
    .map((id) => userMap?.get(id)?.name)
    .filter((n): n is string => Boolean(n))

  if (loading) return <LoadingBlock />
  return (
    <div className="space-y-3">
      <div className="bg-or-tint/60 border border-line-soft rounded-xl p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="eyebrow">SETTER ASSIGNÉ</div>
          <div className="text-sm font-semibold truncate">{setterNames.length > 0 ? setterNames.join(' · ') : 'Aucun'}</div>
        </div>
        <span className="text-xs text-muted whitespace-nowrap">{(data ?? []).length} appel{(data ?? []).length > 1 ? 's' : ''}</span>
      </div>
      {!data || data.length === 0 ? (
        <p className="text-faint">Aucun appel pour ce lead.</p>
      ) : (
        data.map((c) => (
          <div key={c.id} className="bg-white/60 border border-line rounded-xl p-3">
            <div className="flex items-center justify-between mb-1 gap-2">
              <span className={`status-badge ${CALL_RESULT_BADGE[c.result] ?? 'bg-cream-darker text-text'}`}>{CALL_RESULT_LABEL[c.result] ?? c.result}</span>
              <span className="text-[11px] text-faint whitespace-nowrap">{formatDate(c.calledAt)}</span>
            </div>
            <div className="text-xs text-muted flex items-center gap-1">
              <Icon name="users" size={11} />
              {userMap?.get(c.setterId)?.name ?? 'Setter inconnu'}
            </div>
            {c.nextCallbackAt && (
              <div className="text-xs text-cuivre mt-1">Rappel prévu : {formatDate(c.nextCallbackAt)}</div>
            )}
            {c.notes && <p className="text-sm mt-2 text-text whitespace-pre-line">{c.notes}</p>}
          </div>
        ))
      )}
    </div>
  )
}

function RdvTab({ lead, userMap, onSaved }: { lead: LeadResponse; userMap?: Map<string, UserResponse>; onSaved?: () => void }) {
  const { data, loading, refetch } = useRdvList({ leadId: lead.id, limit: 50 })
  const [syncingGhl, setSyncingGhl] = useState(false)
  const [syncTried, setSyncTried] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [ghlEvents, setGhlEvents] = useState<GhlCalendarEvent[]>([])

  const rdvs = data ?? []
  const shouldSyncGhlRdv = Boolean(
    lead.externalId
    && !loading
    && !syncTried
    && (rdvs.length === 0 || rdvs.some((rdv) => !rdv.commercialId)),
  )

  useEffect(() => {
    if (!shouldSyncGhlRdv) return
    let cancelled = false
    setSyncTried(true)
    setSyncingGhl(true)
    setSyncError(null)
    syncLeadGhlCalendarEvents(lead.id)
      .then((result) => {
        if (cancelled) return
        setGhlEvents(result.events ?? [])
        if (result.matched > 0 || result.created > 0 || result.updated > 0) refetch()
      })
      .catch((error) => {
        if (cancelled) return
        setSyncError(error instanceof Error ? error.message : 'Synchronisation GHL impossible')
      })
      .finally(() => {
        if (!cancelled) setSyncingGhl(false)
      })
    return () => { cancelled = true }
  }, [lead.id, shouldSyncGhlRdv, refetch])

  if (loading) return <LoadingBlock />

  const callbackCard = lead.nextCallbackAt ? <CallbackCard nextCallbackAt={lead.nextCallbackAt} /> : null
  const matchedGhlEvents = findLeadGhlEvents(lead, ghlEvents)
  if (rdvs.length === 0 && matchedGhlEvents.length === 0) {
    return (
      <div className="space-y-3">
        {callbackCard}
        {syncingGhl && <p className="text-xs text-muted">Recherche du RDV envoyé à GHL…</p>}
        {syncError && <p className="text-xs text-rouille">GHL : {syncError}</p>}
        {!callbackCard && !syncingGhl && <p className="text-faint">Aucun RDV pour ce lead.</p>}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {callbackCard}
      {syncingGhl && <p className="text-xs text-muted">Mise à jour GHL en cours…</p>}
      {syncError && <p className="text-xs text-rouille">GHL : {syncError}</p>}
      {rdvs.map((r) => {
        const ghlEvent = findMatchingGhlEvent(lead, r, matchedGhlEvents)
        const commercialName = rdvCommercialName(r, ghlEvent, userMap)
        return (
          <RdvInfoCard
            key={r.id}
            rdv={r}
            lead={lead}
            ghlEvent={ghlEvent}
            commercialName={commercialName}
            onUpdated={() => { refetch(); onSaved?.() }}
          />
        )
      })}
      {rdvs.length === 0 && matchedGhlEvents.map((event) => (
        <GhlRdvInfoCard key={event.id} event={event} userMap={userMap} />
      ))}
    </div>
  )
}

function RdvInfoCard({ rdv, lead, ghlEvent, commercialName, onUpdated }: { rdv: RdvResponse; lead: LeadResponse; ghlEvent?: GhlCalendarEvent; commercialName: string | null; onUpdated?: () => void }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <EditRdvForm
        rdv={rdv}
        lead={lead}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onUpdated?.() }}
      />
    )
  }

  return (
    <div className="bg-white/70 border border-line rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-or">RDV {rdv.status}</span>
          <div className="text-sm font-semibold text-text mt-1">{formatRdvDate(rdv.scheduledAt)}</div>
        </div>
        <div className="flex items-center gap-2">
          {rdv.externalId && <span className="text-[10px] font-bold uppercase tracking-widest text-success bg-success-tint rounded-full px-2 py-1">GHL</span>}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-or hover:underline inline-flex items-center gap-1"
            title="Modifier le RDV et les infos envoyées à GHL"
          >
            <Icon name="edit" size={12} /> Modifier
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MiniInfo label="Date" value={formatRdvDay(rdv.scheduledAt)} />
        <MiniInfo label="Heure" value={formatRdvTime(rdv.scheduledAt)} />
        <MiniInfo label="Commercial assigné" value={commercialName ?? 'Non attribué'} wide />
        <MiniInfo label="Type" value={rdv.locationType} />
        {ghlEvent?.sector && <MiniInfo label="Secteur GHL" value={ghlEvent.sector} />}
      </div>
      {rdv.result && <div className="text-xs text-text mt-3">Résultat : <span className="font-semibold">{rdv.result}</span></div>}
      {rdv.notes && <p className="text-sm mt-3 text-text whitespace-pre-line">{rdv.notes}</p>}
    </div>
  )
}

// Formulaire d'édition d'un RDV déjà créé (et potentiellement déjà envoyé à GHL).
// Replanification + note + infos lead. À l'enregistrement, le backend pousse vers
// GHL (appointment + contact) puis met le local à jour.
function EditRdvForm({ rdv, lead, onCancel, onSaved }: { rdv: RdvResponse; lead: LeadResponse; onCancel: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(() => isoToReunionDateInput(rdv.scheduledAt))
  const [time, setTime] = useState(() => isoToReunionTimeInput(rdv.scheduledAt))
  const [notes, setNotes] = useState(rdv.notes ?? '')
  const [info, setInfo] = useState(() => leadToNotesForm(lead))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (!date || !time) throw new Error('Renseigne la date et l’heure du RDV.')
      const email = info.email.trim()
      if (email && !isValidEmail(email)) throw new Error('Email invalide : corrige ou vide le champ email.')
      const payload = {
        scheduledAt: rdvAtToReunionIso(`${date}T${time}`),
        notes: notes.trim() === '' ? null : notes.trim(),
        firstName: info.firstName.trim() === '' ? null : info.firstName.trim(),
        lastName: info.lastName.trim() === '' ? null : info.lastName.trim(),
        email: email === '' ? null : email,
        phone: info.phone.trim() === '' ? null : info.phone.trim(),
        addressLine: info.addressLine.trim() === '' ? null : info.addressLine.trim(),
        city: info.city.trim() === '' ? null : info.city.trim(),
        postalCode: info.postalCode.trim() === '' ? null : info.postalCode.trim(),
      }
      await updateGhlAppointment(rdv.id, payload)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Modification impossible')
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof LeadNotesForm) => (v: string) => setInfo((f) => ({ ...f, [key]: v }))

  return (
    <div className="bg-white/80 border border-or/30 rounded-xl p-3 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-or">Modifier le RDV</span>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={saving} className="text-xs font-semibold text-faint hover:underline disabled:opacity-50">Annuler</button>
          <button onClick={save} disabled={saving} className="text-xs font-semibold text-or hover:underline disabled:opacity-50 inline-flex items-center gap-1">
            {saving ? <Spinner size={14} stroke={2} /> : null}Enregistrer
          </button>
        </div>
      </div>
      {error && <div className="text-xs text-rouille bg-rouille-tint/40 rounded p-2">{error}</div>}
      {rdv.externalId && <p className="text-[11px] text-muted">Les changements sont aussi poussés vers GHL (RDV + contact).</p>}

      <div className="grid grid-cols-2 gap-2">
        <DateOnlyInput label="Date" value={date} onChange={setDate} />
        <div>
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">Heure</div>
          <input type="time" step={60} value={time} onChange={(e) => setTime(e.target.value)} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full" />
        </div>
      </div>
      <div>
        <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">Note transmise</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-20 resize-none" placeholder="Note pour le commercial…" />
      </div>

      <div className="border-t border-line-soft pt-3 space-y-2">
        <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Infos lead (mises à jour dans GHL)</div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Prénom" value={info.firstName} onChange={set('firstName')} />
          <Input label="Nom" value={info.lastName} onChange={set('lastName')} />
        </div>
        <Input label="Téléphone" value={info.phone} onChange={set('phone')} placeholder="+262 692 ..." />
        <Input label="Email" value={info.email} onChange={set('email')} type="email" />
        <Input label="Adresse" value={info.addressLine} onChange={set('addressLine')} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Ville" value={info.city} onChange={set('city')} />
          <Input label="Code postal" value={info.postalCode} onChange={set('postalCode')} placeholder="97400" />
        </div>
      </div>
    </div>
  )
}

function isoToReunionDateInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // en-CA → format YYYY-MM-DD, attendu par <input type="date">.
  return d.toLocaleDateString('en-CA', { timeZone: 'Indian/Reunion' })
}

function isoToReunionTimeInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Indian/Reunion' })
}

function GhlRdvInfoCard({ event, userMap }: { event: GhlCalendarEvent; userMap?: Map<string, UserResponse> }) {
  const commercialName = ghlCommercialName(event, userMap)
  return (
    <div className="bg-white/70 border border-success/25 rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-success">RDV GHL trouvé</span>
          <div className="text-sm font-semibold text-text mt-1">{formatRdvDate(event.startTime)}</div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-success bg-success-tint rounded-full px-2 py-1">GHL live</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MiniInfo label="Date" value={formatRdvDay(event.startTime)} />
        <MiniInfo label="Heure" value={formatRdvTime(event.startTime)} />
        <MiniInfo label="Commercial assigné" value={commercialName ?? 'Non attribué'} wide />
        {event.sector && <MiniInfo label="Secteur" value={event.sector} />}
        {event.status && <MiniInfo label="Statut GHL" value={event.status} />}
      </div>
      {event.notes && <p className="text-sm mt-3 text-text whitespace-pre-line">{event.notes}</p>}
    </div>
  )
}

function MiniInfo({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <div className="text-[10px] font-bold text-faint uppercase tracking-widest">{label}</div>
      <div className="font-semibold text-text mt-0.5">{value || '—'}</div>
    </div>
  )
}

function findLeadGhlEvents(lead: LeadResponse, events: GhlCalendarEvent[]): GhlCalendarEvent[] {
  if (events.length === 0) return []
  const leadContact = cleanField(lead.externalId)
  const leadPhone = normalizePhone(lead.phone)
  const leadEmail = cleanField(lead.email)?.toLowerCase()
  return events.filter((event) => {
    if (leadContact && event.contactId === leadContact) return true
    if (leadPhone && normalizePhone(event.contactPhone) === leadPhone) return true
    if (leadEmail && event.contactEmail?.toLowerCase() === leadEmail) return true
    return false
  })
}

function findMatchingGhlEvent(lead: LeadResponse, rdv: RdvResponse, events: GhlCalendarEvent[]): GhlCalendarEvent | undefined {
  if (events.length === 0) return undefined
  if (rdv.externalId) {
    const byId = events.find((event) => event.id === rdv.externalId)
    if (byId) return byId
  }
  const rdvTs = new Date(rdv.scheduledAt).getTime()
  return events.find((event) => {
    if (lead.externalId && event.contactId === lead.externalId) return true
    const eventTs = new Date(event.startTime).getTime()
    return Number.isFinite(rdvTs) && Number.isFinite(eventTs) && Math.abs(rdvTs - eventTs) < 5 * 60 * 1000
  })
}

function rdvCommercialName(rdv: RdvResponse, event: GhlCalendarEvent | undefined, userMap?: Map<string, UserResponse>): string | null {
  if (rdv.commercialId && userMap?.get(rdv.commercialId)?.name) return userMap.get(rdv.commercialId)?.name ?? null
  return event ? ghlCommercialName(event, userMap) : null
}

function ghlCommercialName(event: GhlCalendarEvent, userMap?: Map<string, UserResponse>): string | null {
  if (event.commercialId && userMap?.get(event.commercialId)?.name) return userMap.get(event.commercialId)?.name ?? null
  return cleanField(event.commercialName) ?? cleanField(event.assignedUserId)
}

function normalizePhone(value?: string | null): string | null {
  const cleaned = cleanField(value)?.replace(/\D/g, '')
  return cleaned && cleaned.length >= 6 ? cleaned : null
}

function formatRdvDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Indian/Reunion' })
  return `${day[0].toUpperCase()}${day.slice(1)} à ${formatRdvTime(iso)}`
}

function formatRdvDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Indian/Reunion' })
}

function formatRdvTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Reunion' })
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
  type SetterStatus = '' | 'non_qualifie' | 'a_rappeler' | 'pas_de_reponse' | 'qualifie' | 'qualifie_specialiste'
  type Step = 'eligibility' | 'qualification' | 'secteur' | 'rdv' | 'confirmation' | 'done'

  const [setterStatus, setSetterStatus] = useState<SetterStatus>(() => statusToSetterStatus(lead.status))
  const [step, setStep] = useState<Step>('eligibility')
  const [eligibilityNotes, setEligibilityNotes] = useState<EligibilityNotes>(EMPTY_ELIGIBILITY_NOTES)
  const [commentaire, setCommentaire] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [sector, setSector] = useState<'Nord' | 'Sud' | 'Est' | 'Ouest' | ''>('')
  const [rdvDate, setRdvDate] = useState(todayInputValue())
  const [rdvAt, setRdvAt] = useState('')
  const [form, setForm] = useState<LeadNotesForm>(() => leadToNotesForm(lead))
  // Snapshot des champs lead sur lesquels le formulaire est aligné. Sert à fusionner
  // les modifs venues d'ailleurs (onglet Infos) sans écraser ce que le setter a déjà
  // saisi dans le formulaire final.
  const leadSnapshotRef = useRef<LeadNotesForm>(leadToNotesForm(lead))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const agendaDate = rdvDate || todayInputValue()
  const agendaPeriod = useMemo(() => dayPeriodFromInput(agendaDate), [agendaDate])
  const shouldLoadCalendarData = step === 'rdv' || step === 'confirmation'
  const { data: agendaRdvs, loading: agendaLoading, refetch: refetchAgenda } = useRdvList(shouldLoadCalendarData ? {
    fromDate: agendaPeriod.from.toISOString(),
    toDate: agendaPeriod.to.toISOString(),
    limit: 80,
  } : null)
  const { data: ghlConfig } = useGhlCalendarConfig(shouldLoadCalendarData)
  const selectedSectorConfig = ghlConfig?.sectors.find((item) => normalizeSectorKey(item.sector) === normalizeSectorKey(sector))
  const slotRange = shouldLoadCalendarData && sector ? buildDayRange(rdvDate) : null
  const { data: ghlSlotsData, loading: ghlSlotsLoading, refetch: refetchGhlSlots } = useGhlFreeSlots({
    sector: shouldLoadCalendarData ? sector || undefined : undefined,
    calendarId: shouldLoadCalendarData ? selectedSectorConfig?.calendarId || undefined : undefined,
    from: slotRange?.from,
    to: slotRange?.to,
    timezone: 'Indian/Reunion',
  })
  const ghlTimeSlots = (ghlSlotsData?.slots ?? []).map((slot) => slotToReunionTime(slot.startTime)).filter(Boolean)
  const commercialTimeSlots = ghlConfig?.configured && rdvDate ? uniqueStrings(ghlTimeSlots) : COMMERCIAL_RDV_TIME_SLOTS
  void notes
  void setNotes

  // Secteur déduit automatiquement de la ville du lead (mapping unique des 24 communes,
  // cf. lib/sector). Évite que le setter choisisse le mauvais secteur à la main.
  const sectorCity = form.city || lead.city || ''
  const suggestedSector = useMemo(() => {
    const s = sectorFromCity(sectorCity)
    return s === 'Autre' ? '' : s
  }, [sectorCity])

  // Pré-sélection : à l'arrivée sur l'étape secteur, si rien n'est choisi et qu'on a une
  // suggestion fiable depuis la ville, on la pose. Le setter reste libre de la changer.
  useEffect(() => {
    if (step === 'secteur' && !sector && suggestedSector) setSector(suggestedSector)
  }, [step, sector, suggestedSector])

  // Restaure le workflow en cours depuis localStorage (par lead.id) — survit aux
  // remounts (PersistentLeadSidebar peut se démonter brièvement quand useLead
  // refetch, F5, déconnexion WS, etc.) sans faire perdre la saisie en cours.
  useEffect(() => {
    const defaultForm = leadToNotesForm(lead)
    // On (ré)aligne le snapshot sur le lead courant : tout ce qui arrive ensuite
    // via la prop lead (modif onglet Infos) sera fusionné par l'effet de resync.
    leadSnapshotRef.current = defaultForm
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
          rdvDate: string
          rdvAt: string
          form: typeof defaultForm
          leadSnapshot: typeof defaultForm
        }>
        setSetterStatus(parsed.setterStatus ?? statusToSetterStatus(lead.status))
        setStep(parsed.step ?? 'eligibility')
        setEligibilityNotes(parsed.eligibilityNotes ?? EMPTY_ELIGIBILITY_NOTES)
        setCommentaire(parsed.commentaire ?? '')
        setCallbackAt(parsed.callbackAt ?? '')
        setSector(parsed.sector ?? '')
        setRdvDate(parsed.rdvDate ?? todayInputValue())
        setRdvAt(parsed.rdvAt ?? '')
        // Fusion à la restauration : on privilégie la valeur FRAÎCHE du lead (modif
        // faite dans l'onglet Infos pendant qu'on était ailleurs) SAUF pour les champs
        // que le setter avait lui-même édités ici (valeur persistée ≠ snapshot lead
        // persisté). Sans snapshot (anciens brouillons), on garde la saisie persistée.
        const persistedForm: Partial<typeof defaultForm> = parsed.form ?? {}
        const persistedSnapshot = parsed.leadSnapshot
        const mergedForm = { ...defaultForm }
        for (const key of Object.keys(defaultForm) as (keyof typeof defaultForm)[]) {
          const persistedVal = persistedForm[key]
          if (persistedVal === undefined) continue
          const setterEdited = persistedSnapshot ? persistedVal !== persistedSnapshot[key] : true
          if (setterEdited) mergedForm[key] = persistedVal
        }
        setForm(mergedForm)
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
    setRdvDate(todayInputValue())
    setRdvAt('')
    setForm(defaultForm)
    setError(null)
    setSuccess(null)
  }, [lead.id])

  // Resync : quand le lead est modifié ailleurs (onglet Infos enregistre → refetch →
  // la prop lead change sans changer d'id), on reporte ces modifs dans le formulaire
  // final. On ne touche qu'aux champs que le setter n'a pas lui-même modifiés ici
  // (form[key] === snapshot[key]) pour ne pas écraser une saisie en cours.
  useEffect(() => {
    const next = leadToNotesForm(lead)
    const prev = leadSnapshotRef.current
    leadSnapshotRef.current = next
    setForm((current) => {
      let changed = false
      const merged = { ...current }
      for (const key of Object.keys(next) as (keyof LeadNotesForm)[]) {
        if (next[key] !== prev[key] && current[key] === prev[key]) {
          merged[key] = next[key]
          changed = true
        }
      }
      return changed ? merged : current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lead.firstName, lead.lastName, lead.email, lead.phone, lead.addressLine,
    lead.city, lead.postalCode,
  ])

  // Sauvegarde à chaque modification (debounced via React batching) — clé par lead.
  useEffect(() => {
    if (step === 'done') return // workflow terminé, on ne persiste plus
    try {
      localStorage.setItem(notesTabStorageKey(lead.id), JSON.stringify({
        setterStatus, step, eligibilityNotes, commentaire, callbackAt, sector, rdvDate, rdvAt, form,
        // Snapshot des valeurs lead sur lesquelles `form` était aligné : permet, à la
        // restauration (remount après passage par l'onglet Infos), de distinguer un
        // champ édité par le setter ici d'un champ resté à la valeur du lead.
        leadSnapshot: leadSnapshotRef.current,
      }))
    } catch {}
  }, [lead.id, setterStatus, step, eligibilityNotes, commentaire, callbackAt, sector, rdvDate, rdvAt, form])

  // Workflow validé : on nettoie le brouillon pour que la prochaine visite reparte propre.
  useEffect(() => {
    if (step === 'done') {
      try { localStorage.removeItem(notesTabStorageKey(lead.id)) } catch {}
    }
  }, [step, lead.id])

  const eligibilitySummary = formatEligibilityNotes(eligibilityNotes)
  const noteFinale = [eligibilitySummary, commentaire.trim()].filter(Boolean).join('\n\n') || null
  const rdvTransferNote = formatRdvTransferNote({
    sector,
    eligibilitySummary,
    commentaire,
  })

  async function saveCallAndLead(kind: Exclude<SetterStatus, ''>) {
    setError(null)
    setSaving(true)
    try {
      if (kind === 'non_qualifie') {
        if (!commentaire.trim()) throw new Error('Ajoute un commentaire pour expliquer pourquoi le lead est non qualifié.')
        await createCallLog({ leadId: lead.id, result: 'refus', notes: noteFinale })
        setResult('')
        setSuccess('Lead marqué non qualifié.')
        setStep('done')
      } else if (kind === 'pas_de_reponse') {
        await createCallLog({ leadId: lead.id, result: 'non_joint', notes: noteFinale || null })
        setResult('')
        setSuccess('Lead marqué en pas de réponse.')
        setStep('done')
      } else if (kind === 'a_rappeler') {
        if (!callbackAt) throw new Error('Choisis la date et l’heure du rappel.')
        await createCallLog({ leadId: lead.id, result: 'rappel_planifie', nextCallbackAt: new Date(callbackAt).toISOString(), notes: noteFinale || null })
        setResult('')
        setSuccess('Rappel planifié et lead passé en À rappeler.')
        setStep('done')
      } else if (kind === 'qualifie_specialiste') {
        if (!commentaire.trim()) throw new Error('Ajoute un commentaire expliquant que le lead a déjà été qualifié par un spécialiste.')
        await createCallLog({ leadId: lead.id, result: 'joint', notes: noteFinale })
        await updateLead(lead.id, { status: 'qualifie' })
        setResult('')
        setSuccess('Lead marqué qualifié (RDV déjà géré par un spécialiste sur GHL).')
        setStep('done')
      } else {
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
      const firstName = cleanField(form.firstName)
      const lastName = cleanField(form.lastName)
      const email = cleanField(form.email)
      const phone = cleanField(form.phone)
      const addressLine = cleanField(form.addressLine)
      const city = cleanField(form.city)
      const postalCode = cleanField(form.postalCode)
      if (email && !isValidEmail(email)) throw new Error('Email invalide : corrige ou vide le champ email.')
      if (postalCode && postalCode.length > 20) throw new Error('Code postal trop long : 20 caractères maximum.')
      const leadPatch = {
        status: 'qualifie',
        firstName,
        lastName,
        email,
        phone,
        addressLine,
        city,
        postalCode,
      } as const
      const rdvPromise = ghlConfig?.configured
        ? createGhlAppointment({
          leadId: lead.id,
          sector,
          calendarId: selectedSectorConfig?.calendarId || undefined,
          scheduledAt: rdvAtToReunionIso(rdvAt),
          locationType: 'domicile',
          notes: rdvTransferNote,
          firstName,
          lastName,
          email,
          phone,
          addressLine,
          city,
          postalCode,
        })
        : createRdv({
          leadId: lead.id,
          commercialId: null,
          scheduledAt: rdvAtToReunionIso(rdvAt),
          locationType: 'domicile',
          notes: rdvTransferNote,
        })
      await Promise.all([
        updateLead(lead.id, leadPatch),
        rdvPromise,
        createCallLog({ leadId: lead.id, result: 'joint', notes: noteFinale || null }),
      ])
      refetchAgenda()
      refetchGhlSlots()
      setSuccess(ghlConfig?.configured ? 'RDV créé dans GHL, agenda actualisé.' : 'RDV créé en local. Agenda actualisé.')
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
          <div className="rounded-[18px] border border-or/30 bg-or-tint/40 p-4 space-y-3">
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark mb-1">Avant tout — le lead a-t-il pu répondre ?</div>
              <p className="text-xs text-muted">Si le lead n’a pas répondu ou demande à être rappelé, enregistre le statut ici sans passer par l’éligibilité.</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <StatusChoice active={setterStatus === 'a_rappeler'} icon="clock" title="À rappeler" text="Date et heure du rappel" onClick={() => { setSetterStatus('a_rappeler'); setResult('rappel_planifie') }} />
              <StatusChoice active={setterStatus === 'pas_de_reponse'} icon="phone-off" title="Pas de réponse" text="Aucun champ requis" onClick={() => { setSetterStatus('pas_de_reponse'); setResult('non_joint') }} />
              <StatusChoice active={setterStatus === 'non_qualifie'} icon="x" title="Pas qualifié" text="Commentaire obligatoire" onClick={() => { setSetterStatus('non_qualifie'); setResult('refus') }} />
              <StatusChoice active={setterStatus === 'qualifie_specialiste'} icon="target" title="Déjà qualifié par spécialiste" text="Commentaire obligatoire — pas d’envoi GHL" onClick={() => { setSetterStatus('qualifie_specialiste'); setResult('joint') }} />
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
            {setterStatus === 'non_qualifie' && (
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Commentaire obligatoire : pourquoi pas qualifié ?"
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
                autoFocus={isActiveCall}
              />
            )}
            {setterStatus === 'qualifie_specialiste' && (
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Le lead dit avoir déjà eu un RDV avec un spécialiste. Précise lequel / quand si possible."
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
                autoFocus={isActiveCall}
              />
            )}
            {(setterStatus === 'a_rappeler' || setterStatus === 'pas_de_reponse' || setterStatus === 'non_qualifie' || setterStatus === 'qualifie_specialiste') && (
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
                  <Input label="Si ce n’est pas trop indiscret, vous avez quel âge ?" value={eligibilityNotes.age} onChange={(value) => updateEligibility('age', value)} placeholder="ex: 64 ans / environ 70" />
                </div>
              )}
            </div>

            <Input label="Projet rapidement ou juste à titre informatif ?" value={eligibilityNotes.projectTiming} onChange={(value) => updateEligibility('projectTiming', value)} />
            <Input label="Factures d’électricité chaque mois" value={eligibilityNotes.monthlyBill} onChange={(value) => updateEligibility('monthlyBill', value)} placeholder="ex: 180 € / entre 150 et 200 € / ne sait pas" />

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
              <StatusChoice active={setterStatus === 'qualifie'} icon="check" title="Qualifié" text="Secteur et RDV" onClick={() => { setSetterStatus('qualifie'); setResult('joint') }} />
            </div>
          </div>

          {setterStatus === 'qualifie' && (
            <div className="rounded-[18px] border border-line bg-white/70 p-4 space-y-3">
              <textarea
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
                placeholder="Commentaire (facultatif) : besoins, contexte, objections…"
                className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full h-24 resize-none"
                autoFocus={isActiveCall}
              />
              <p className="text-sm text-muted">Valide la qualification pour passer à la sélection du secteur puis au RDV.</p>
              <button
                onClick={() => saveCallAndLead(setterStatus)}
                disabled={saving}
                className="btn-primary w-full rounded-xl py-2 text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size={16} stroke={2} /> : null}
                Continuer vers secteur
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
          {suggestedSector ? (
            <div className="rounded-[14px] border border-success/30 bg-success-tint px-3 py-2 text-xs text-text">
              Secteur déduit de la ville <span className="font-semibold">« {sectorCity} »</span> :{' '}
              <span className="font-bold">{suggestedSector}</span>. Pré-sélectionné — change-le seulement si l’adresse réelle est ailleurs.
            </div>
          ) : sectorCity ? (
            <div className="rounded-[14px] border border-rouille/30 bg-rouille-tint px-3 py-2 text-xs text-text">
              Ville <span className="font-semibold">« {sectorCity} »</span> non reconnue automatiquement — choisis le secteur à la main.
            </div>
          ) : (
            <div className="rounded-[14px] border border-line bg-white/70 px-3 py-2 text-xs text-muted">
              Aucune ville renseignée — choisis le secteur à la main.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(['Nord', 'Sud', 'Est', 'Ouest'] as const).map((s) => (
              <button key={s} onClick={() => { setSector(s); setStep('rdv') }} className={`relative rounded-[18px] border p-4 text-left ${sector === s ? 'border-or bg-or-tint text-or-dark' : 'border-line bg-white/70 hover:bg-white'}`}>
                {suggestedSector === s && (
                  <span className="absolute right-2 top-2 rounded-full bg-success/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">Suggéré</span>
                )}
                <Icon name="map-pin" size={16} />
                <div className="font-bold mt-2">{s}</div>
              </button>
            ))}
          </div>
          {sector && suggestedSector && sector !== suggestedSector && (
            <div className="rounded-[14px] border border-rouille/40 bg-rouille-tint px-3 py-2 text-xs text-text">
              ⚠️ Tu as choisi <span className="font-bold">{sector}</span> alors que la ville « {sectorCity} » correspond au secteur <span className="font-bold">{suggestedSector}</span>. Vérifie l’adresse avant de continuer.
            </div>
          )}
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
          <DateOnlyInput label="Date du RDV commercial" value={rdvDate} onChange={(date) => { setRdvDate(date); setRdvAt('') }} />
          <InlineRdvAgenda
            selectedAt={rdvAt}
            rdvs={agendaRdvs ?? []}
            loading={Boolean(agendaLoading || (ghlConfig?.configured && rdvDate && ghlSlotsLoading))}
            leadId={lead.id}
            timeSlots={commercialTimeSlots}
            onSelect={(time) => setRdvAt(`${rdvDate}T${time}`)}
          />
          <p className="text-xs text-muted">
            {ghlConfig?.configured
              ? ghlSlotsLoading
                ? 'Chargement des créneaux libres GHL…'
                : rdvDate && commercialTimeSlots.length === 0
                  ? 'Aucun créneau libre GHL sur cette date. Choisis une autre date.'
                  : 'Mini agenda synchronisé avec GHL en temps réel.'
              : 'Mode local : ajoute la clé GHL pour charger les vrais créneaux libres.'}
          </p>
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
          <div className="rounded-[18px] border border-or/20 bg-or-tint p-4 space-y-2">
            <div className="text-[10px] font-bold tracking-widest uppercase text-or-dark">Résumé final avant validation</div>
            <Field label="LEAD" value={`${form.firstName} ${form.lastName}`.trim() || fullName(lead)} />
            <Field label="STATUT" value="Qualifié" />
            <Field label="EMAIL" value={(form.email || lead.email) ?? '—'} />
            <Field label="TÉLÉPHONE" value={(form.phone || lead.phone) ?? '—'} />
            <Field label="NOTES D’APPEL ENVOYÉES" value={noteFinale || '—'} />
            <Field label="SECTEUR" value={sector || '—'} />
            <Field label="RDV" value={rdvAt ? formatDate(rdvAtToReunionIso(rdvAt)) : '—'} />
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
  timeSlots,
  onSelect,
}: {
  selectedAt: string
  rdvs: RdvResponse[]
  loading: boolean
  leadId: string
  timeSlots: string[]
  onSelect: (time: string) => void
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
  // Créneaux occupés masqués, sauf ceux du lead en cours ou déjà sélectionnés
  const visibleSlots = timeSlots.filter((slot) => {
    const matches = byTime.get(slot) ?? []
    return matches.length === 0 || matches.some((r) => r.leadId === leadId) || selectedTime === slot
  })

  return (
    <div className="rounded-[18px] border border-line bg-white/70 overflow-hidden">
      <div className="px-3 py-2 border-b border-line-soft flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Agenda du jour</div>
          <div className="text-xs text-muted">{visibleSlots.length} créneau{visibleSlots.length > 1 ? 'x' : ''} libre{visibleSlots.length > 1 ? 's' : ''}</div>
        </div>
        {loading && <Spinner size={14} stroke={2} label="Agenda…" />}
      </div>
      <div className="divide-y divide-line-soft max-h-64 overflow-y-auto">
        {visibleSlots.map((slot) => {
          const slotLabel = slot
          const matches = byTime.get(slotLabel) ?? []
          const selected = selectedTime === slot
          const busy = matches.length > 0
          return (
            <button
              key={slot}
              type="button"
              onClick={() => onSelect(slot)}
              className={`w-full px-3 py-2 flex items-start gap-3 text-left ${selected ? 'bg-or-tint' : busy ? 'bg-white/80' : 'bg-white/40 hover:bg-or-tint/60'}`}
            >
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
            </button>
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
  sector,
  eligibilitySummary,
  commentaire,
}: {
  sector: string
  eligibilitySummary: string
  commentaire: string
}): string {
  const eligibility = eligibilitySummary.replace(/^Notes d’éligibilité setter\n?/, '').trim()
  return [
    `RDV ECOI${sector ? ` — ${sector}` : ''}`,
    commentaire.trim() ? `Commentaire setter :\n${commentaire.trim()}` : null,
    eligibility ? `Éligibilité :\n${eligibility}` : null,
  ].filter(Boolean).join('\n')
}

function formatEligibilityNotes(notes: EligibilityNotes): string {
  const lines = [
    notes.isOwner && `Propriétaire maison : ${yesNoLabel(notes.isOwner)}`,
    notes.activity && `Situation : ${notes.activity === 'retraite' ? `Retraité${notes.age.trim() ? ` · âge ${notes.age.trim()}` : ''}` : 'En activité'}`,
    notes.projectTiming.trim() && `Intention projet : ${notes.projectTiming.trim()}`,
    notes.monthlyBill.trim() && `Facture électricité mensuelle : ${notes.monthlyBill.trim()}`,
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

const COMMERCIAL_RDV_TIME_SLOTS = Array.from({ length: 16 }, (_, i) => {
  const totalMinutes = 8 * 60 + i * 30
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
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

function DateOnlyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">{label}</div>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full" />
    </label>
  )
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

function Input({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-[10px] font-bold tracking-widest uppercase text-faint mb-1">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full" />
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

function buildDayRange(date: string): { from: string; to: string } | null {
  if (!date) return null
  const from = new Date(`${date}T00:00:00+04:00`)
  const to = new Date(`${date}T23:59:59+04:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return { from: from.toISOString(), to: to.toISOString() }
}

function slotToReunionTime(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Indian/Reunion' })
}

function rdvAtToReunionIso(value: string): string {
  const [date, time] = value.split('T')
  if (!date || !time) return new Date(value).toISOString()
  return new Date(`${date}T${time}:00+04:00`).toISOString()
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function normalizeSectorKey(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function formatRdvDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Reunion',
  })
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
