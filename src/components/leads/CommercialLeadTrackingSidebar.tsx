import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../Icon'
import { fullName, STATUS_LABEL, type LeadResponse } from '../../lib/types'

type TrackingStage = 'a_traiter' | 'contacte' | 'devis' | 'relance' | 'bloque' | 'gagne'
type TrackingPriority = 'normal' | 'urgent' | 'veille'
type TrackingAction = 'appel' | 'sms' | 'rdv' | 'devis' | 'relance'
type ChecklistKey = 'contact' | 'besoin' | 'eligibilite' | 'devis' | 'decision'

type CommercialTracking = {
  stage: TrackingStage
  priority: TrackingPriority
  nextAction: TrackingAction
  nextActionAt: string
  note: string
  checklist: Record<ChecklistKey, boolean>
  updatedAt: string
}

type Props = {
  lead: LeadResponse
  onClose: () => void
  onSaved?: () => void
  className?: string
}

const STORAGE_PREFIX = 'ecoi.commercialLeadTracking.v1.'

const STAGES: { key: TrackingStage; label: string; desc: string }[] = [
  { key: 'a_traiter', label: 'À traiter', desc: 'Premier suivi commercial à faire' },
  { key: 'contacte', label: 'Contacté', desc: 'Échange commercial démarré' },
  { key: 'devis', label: 'Devis', desc: 'Offre ou chiffrage en cours' },
  { key: 'relance', label: 'Relance', desc: 'Décision à pousser' },
  { key: 'bloque', label: 'Bloqué', desc: 'Point bloquant identifié' },
  { key: 'gagne', label: 'Gagné', desc: 'Lead converti' },
]

const PRIORITIES: { key: TrackingPriority; label: string; className: string }[] = [
  { key: 'normal', label: 'Normal', className: 'border-line bg-white text-muted' },
  { key: 'urgent', label: 'Urgent', className: 'border-rouille/30 bg-rouille-tint text-rouille' },
  { key: 'veille', label: 'À surveiller', className: 'border-or/30 bg-or-tint text-or-dark' },
]

const ACTIONS: { key: TrackingAction; label: string }[] = [
  { key: 'appel', label: 'Appeler' },
  { key: 'sms', label: 'SMS' },
  { key: 'rdv', label: 'RDV' },
  { key: 'devis', label: 'Devis' },
  { key: 'relance', label: 'Relance' },
]

const CHECKLIST: { key: ChecklistKey; label: string }[] = [
  { key: 'contact', label: 'Contact vérifié' },
  { key: 'besoin', label: 'Besoin confirmé' },
  { key: 'eligibilite', label: 'Éligibilité validée' },
  { key: 'devis', label: 'Devis / offre envoyé' },
  { key: 'decision', label: 'Décision suivie' },
]

const EMPTY_TRACKING: CommercialTracking = {
  stage: 'a_traiter',
  priority: 'normal',
  nextAction: 'appel',
  nextActionAt: '',
  note: '',
  checklist: {
    contact: false,
    besoin: false,
    eligibilite: false,
    devis: false,
    decision: false,
  },
  updatedAt: '',
}

export function CommercialLeadTrackingSidebar({ lead, onClose, className = '' }: Props) {
  const [tracking, setTracking] = useState<CommercialTracking>(() => readTracking(lead.id))
  const completed = useMemo(() => CHECKLIST.filter((item) => tracking.checklist[item.key]).length, [tracking.checklist])
  const completion = Math.round((completed / CHECKLIST.length) * 100)

  useEffect(() => {
    setTracking(readTracking(lead.id))
  }, [lead.id])

  useEffect(() => {
    writeTracking(lead.id, tracking)
  }, [lead.id, tracking])

  const updateTracking = (patch: Partial<CommercialTracking>) => {
    setTracking((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }

  const toggleChecklist = (key: ChecklistKey) => {
    setTracking((current) => ({
      ...current,
      checklist: { ...current.checklist, [key]: !current.checklist[key] },
      updatedAt: new Date().toISOString(),
    }))
  }

  const markToday = () => updateTracking({ nextActionAt: toDateTimeLocal(addHours(new Date(), 2)), priority: 'urgent' })
  const markTomorrow = () => updateTracking({ nextActionAt: toDateTimeLocal(addDays(new Date(), 1)), priority: 'normal' })

  return (
    <aside className={`w-[480px] max-w-[94vw] overflow-y-auto border-l border-line bg-white/95 p-5 text-sm shadow-2xl backdrop-blur-2xl ${className}`}>
      <div className="sticky top-0 z-10 -mx-5 -mt-5 border-b border-line bg-white/90 px-5 py-4 backdrop-blur-2xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full p-2 text-muted hover:bg-cream hover:text-text" aria-label="Fermer le suivi commercial">
          <Icon name="x" size={18} />
        </button>
        <div className="eyebrow text-or-dark">Suivi commercial</div>
        <h2 className="mt-1 pr-10 text-xl font-black text-text">{fullName(lead)}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="status-badge bg-cream text-muted">{STATUS_LABEL[lead.status] ?? lead.status}</span>
          {lead.latestRdvAt && <span className="status-badge bg-success-tint text-success">RDV {formatDateTime(lead.latestRdvAt)}</span>}
          <span className="status-badge bg-or-tint text-or-dark">Suivi {completion}%</span>
        </div>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3">
        <InfoCard icon="phone" label="Téléphone" value={lead.phone ?? '—'} />
        <InfoCard icon="mail" label="Email" value={lead.email ?? '—'} />
        <InfoCard icon="map-pin" label="Ville" value={[lead.postalCode, lead.city].filter(Boolean).join(' ') || '—'} />
        <InfoCard icon="calendar" label="Dernier contact" value={formatDateTime(lead.latestCallAt ?? lead.lastContactAt)} />
      </section>

      <section className="mt-5 rounded-[24px] border border-line bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow text-faint">Étape commerciale</p>
            <h3 className="font-black text-text">Où en est le lead ?</h3>
          </div>
          <div className="rounded-full bg-cream px-3 py-1 text-xs font-bold text-muted">{completed}/{CHECKLIST.length}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {STAGES.map((stage) => (
            <button
              key={stage.key}
              type="button"
              onClick={() => updateTracking({ stage: stage.key })}
              className={`rounded-2xl border p-3 text-left transition ${tracking.stage === stage.key ? 'border-or bg-or-tint text-text shadow-sm' : 'border-line bg-cream/40 text-muted hover:border-or/50 hover:bg-white'}`}
            >
              <div className="text-sm font-black">{stage.label}</div>
              <div className="mt-1 text-[11px] leading-snug opacity-80">{stage.desc}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-[24px] border border-line bg-white p-4 shadow-sm">
        <p className="eyebrow text-faint">Priorité</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRIORITIES.map((priority) => (
            <button
              key={priority.key}
              type="button"
              onClick={() => updateTracking({ priority: priority.key })}
              className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${tracking.priority === priority.key ? priority.className : 'border-line bg-white text-muted hover:border-or/50'}`}
            >
              {priority.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-[24px] border border-line bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow text-faint">Prochaine action</p>
            <h3 className="font-black text-text">Ne pas perdre le suivi</h3>
          </div>
          <Icon name="clock" size={18} className="text-or-dark" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-bold text-muted">
            Action
            <select
              value={tracking.nextAction}
              onChange={(event) => updateTracking({ nextAction: event.target.value as TrackingAction })}
              className="w-full rounded-2xl border border-line bg-cream px-3 py-2 text-sm text-text outline-none focus:border-or"
            >
              {ACTIONS.map((action) => <option key={action.key} value={action.key}>{action.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-bold text-muted">
            Date / heure
            <input
              type="datetime-local"
              value={tracking.nextActionAt}
              onChange={(event) => updateTracking({ nextActionAt: event.target.value })}
              className="w-full rounded-2xl border border-line bg-cream px-3 py-2 text-sm text-text outline-none focus:border-or"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={markToday} className="rounded-full bg-text px-3 py-1.5 text-xs font-bold text-white">Aujourd'hui</button>
          <button type="button" onClick={markTomorrow} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-muted hover:border-or">Demain</button>
        </div>
      </section>

      <section className="mt-4 rounded-[24px] border border-line bg-white p-4 shadow-sm">
        <p className="eyebrow text-faint">Checklist</p>
        <div className="mt-3 space-y-2">
          {CHECKLIST.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleChecklist(item.key)}
              className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left transition ${tracking.checklist[item.key] ? 'border-success/25 bg-success-tint text-success' : 'border-line bg-cream/45 text-muted hover:border-or/50 hover:bg-white'}`}
            >
              <span className="font-bold">{item.label}</span>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${tracking.checklist[item.key] ? 'border-success bg-success text-white' : 'border-line bg-white text-faint'}`}>
                {tracking.checklist[item.key] && <Icon name="check" size={14} />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-[24px] border border-line bg-white p-4 shadow-sm">
        <label className="space-y-2 text-xs font-bold text-muted">
          Notes de suivi commercial
          <textarea
            value={tracking.note}
            onChange={(event) => updateTracking({ note: event.target.value })}
            rows={5}
            placeholder="Ex : décisionnaire à rappeler, objection prix, documents envoyés…"
            className="w-full resize-none rounded-2xl border border-line bg-cream px-3 py-2 text-sm font-medium text-text outline-none focus:border-or"
          />
        </label>
        <div className="mt-2 text-[11px] text-faint">Sauvegarde automatique sur ce navigateur · dernière mise à jour {tracking.updatedAt ? formatDateTime(tracking.updatedAt) : '—'}</div>
      </section>
    </aside>
  )
}

function InfoCard({ icon, label, value }: { icon: 'phone' | 'mail' | 'map-pin' | 'calendar'; label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-line bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-faint">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <div className="mt-2 truncate font-bold text-text" title={value}>{value}</div>
    </div>
  )
}

function readTracking(leadId: string): CommercialTracking {
  if (typeof window === 'undefined') return EMPTY_TRACKING
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${leadId}`)
  if (!raw) return { ...EMPTY_TRACKING, updatedAt: new Date().toISOString() }
  try {
    const parsed = JSON.parse(raw) as Partial<CommercialTracking>
    return {
      ...EMPTY_TRACKING,
      ...parsed,
      checklist: { ...EMPTY_TRACKING.checklist, ...(parsed.checklist ?? {}) },
    }
  } catch {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${leadId}`)
    return { ...EMPTY_TRACKING, updatedAt: new Date().toISOString() }
  }
}

function writeTracking(leadId: string, tracking: CommercialTracking) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`${STORAGE_PREFIX}${leadId}`, JSON.stringify(tracking))
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function addHours(date: Date, hours: number): Date {
  const next = new Date(date)
  next.setHours(next.getHours() + hours)
  return next
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  next.setHours(9, 0, 0, 0)
  return next
}

function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
