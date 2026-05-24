import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon, type IconName } from '../components/Icon'
import { LoadingBlock, Spinner } from '../components/Spinner'
import { useLeads, useRdvList } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { fullName, type LeadResponse, type LeadStatus, type RdvResponse } from '../lib/types'

type Notif = {
  id: string
  group: string
  icon: IconName
  iconBg: string
  iconColor: string
  borderColor?: string
  title: string
  body: React.ReactNode
  time: string
  sortAt?: number
  urgency: 'now' | 'soon' | 'info'
  to?: string
  reminderKey?: string
}

export function Notifications() {
  const user = useAuth((s) => s.user)
  const isCommercial = user?.role === 'commercial'
  const leadFilters = isCommercial && user?.id ? { assignedToId: user.id, limit: 250 } : { limit: 250 }
  const rdvFilters = isCommercial && user?.id ? { commercialId: user.id, limit: 200 } : { limit: 200 }
  const { data: leadsData, loading: leadsLoading } = useLeads(leadFilters)
  const { data: rdvsData, loading: rdvLoading } = useRdvList(rdvFilters)
  const leads = leadsData ?? []
  const rdvs = rdvsData ?? []
  const minuteTick = useMinuteTicker()
  const notifs = useMemo(() => (
    isCommercial ? buildCommercialNotifications(leads, rdvs) : buildNotifications(leads, rdvs)
  ), [isCommercial, leads, rdvs, minuteTick])
  const loading = leadsLoading || rdvLoading
  const [permission, setPermission] = useState(notificationPermission())

  useBrowserNotifications(notifs)
  useMarkNotificationsSeen(notifs)

  return (
    <AppShell>
      <Topbar eyebrow="NOTIFICATIONS" title={isCommercial ? 'Notifications commerciales' : 'Notifications et rappels'} />
      <div className="px-8 pt-4 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="text-sm text-muted">
          {loading && notifs.length === 0 ? <Spinner size={16} stroke={3} label="Chargement des notifications…" /> : `${notifs.length} notification${notifs.length > 1 ? 's' : ''} active${notifs.length > 1 ? 's' : ''}`}
        </div>
        <button
          onClick={async () => setPermission(await requestNotificationPermission())}
          className="btn-secondary px-4 py-2 rounded-xl text-sm disabled:opacity-50"
          disabled={permission === 'granted' || !supportsBrowserNotifications()}
        >
          {permission === 'granted' ? 'Alertes navigateur actives' : 'Activer alertes navigateur'}
        </button>
      </div>

      <main className="p-8 pt-4 max-w-3xl mx-auto w-full overflow-y-auto space-y-3 flex-grow">
        {loading && notifs.length === 0 ? (
          <LoadingBlock label="Chargement des notifications…" />
        ) : notifs.length === 0 ? (
          <div className="glass-card p-6 text-sm text-muted">
            {isCommercial
              ? 'Aucune notification commerciale : pas de nouveau RDV, pas de RDV imminent et pas de mouvement pipeline récent.'
              : 'Aucune notification urgente : pas de nouveau lead récent, pas de rappel à traiter, pas de RDV imminent.'}
          </div>
        ) : (
          <div className="space-y-3">
            {notifs.map((n) => <NotificationCard key={n.id} notif={n} />)}
          </div>
        )}
      </main>
    </AppShell>
  )
}

function NotificationCard({ notif }: { notif: Notif }) {
  const [calledReminders, setCalledReminders] = useCalledReminders()
  const isCalled = notif.reminderKey ? calledReminders.has(notif.reminderKey) : false
  const toggleCalled = () => {
    if (!notif.reminderKey) return
    const next = new Set(calledReminders)
    if (next.has(notif.reminderKey)) next.delete(notif.reminderKey)
    else next.add(notif.reminderKey)
    writeCalledReminderKeys(next)
    setCalledReminders(next)
  }

  return (
    <div className={`glass-card p-4 flex items-start gap-4 ${notif.borderColor ? `border-l-4 ${notif.borderColor}` : ''} ${isCalled ? 'opacity-60' : ''}`}>
      <div className={`w-10 h-10 rounded-full ${notif.iconBg} flex items-center justify-center shrink-0`}>
        <Icon name={notif.icon} size={18} className={notif.iconColor} />
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex justify-between items-start gap-2">
          <span className={`font-semibold text-sm ${isCalled ? 'line-through text-muted' : ''}`}>{notif.title}</span>
          <span className="text-xs text-faint shrink-0">{notif.time}</span>
        </div>
        <p className={`text-sm text-muted mt-1 ${isCalled ? 'line-through' : ''}`}>{notif.body}</p>
        <div className="mt-3 flex items-center gap-2">
          {notif.to && <Link to={notif.to} className="text-xs font-semibold text-or-dark hover:underline">Ouvrir</Link>}
          {notif.reminderKey && (
            <button
              type="button"
              onClick={toggleCalled}
              className={`text-xs font-semibold rounded-full border px-3 py-1 transition ${isCalled ? 'border-success/40 bg-success-tint text-success' : 'border-line bg-white/70 text-muted hover:border-or hover:text-text'}`}
            >
              {isCalled ? 'Rappel barré' : 'Barrer comme appelé'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function buildNotifications(leads: LeadResponse[], rdvs: RdvResponse[]): Notif[] {
  const now = Date.now()
  const in10Min = now + 10 * 60 * 1000
  const in24h = now - 24 * 60 * 60 * 1000
  const notifications: Notif[] = []

  for (const lead of leads) {
    const name = fullName(lead)
    const leadLink = `/leads?search=${encodeURIComponent(name)}`
    const callbackAt = lead.nextCallbackAt ? new Date(lead.nextCallbackAt).getTime() : null

    const callbackResolved = isCallbackResolved(lead, callbackAt)

    if (callbackAt && callbackAt <= now && (lead.status === 'a_rappeler' || lead.status === 'relance' || lead.nextCallbackAt) && !callbackResolved) {
      notifications.push({
        id: `callback-late-${lead.id}`,
        group: 'RAPPELS EN RETARD',
        icon: 'clock',
        ...NOTIF_COLOR.late,
        title: 'Appel à rappeler maintenant',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: callbackAt,
        urgency: 'now',
        to: leadLink,
        reminderKey: reminderKey(lead),
      })
    } else if (callbackAt && callbackAt <= in10Min && callbackAt > now && !callbackResolved) {
      notifications.push({
        id: `callback-soon-${lead.id}`,
        group: 'DANS 10 MIN',
        icon: 'phone',
        ...NOTIF_COLOR.imminent,
        title: 'Rappel téléphonique imminent',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: callbackAt,
        urgency: 'soon',
        to: leadLink,
        reminderKey: reminderKey(lead),
      })
    } else if (callbackAt && lead.status === 'a_rappeler' && callbackAt <= now + 7 * 24 * 60 * 60 * 1000 && !callbackResolved) {
      // Sort par "quand le rappel a été planifié" (lead.updatedAt) et non par la date future
      // du rappel, sinon un rappel planifié pour demain remonte au-dessus d'un lead arrivé
      // il y a 5 min — ce qui casse la logique "feed chronologique".
      notifications.push({
        id: `callback-planned-${lead.id}`,
        group: 'RAPPELS PROGRAMMÉS',
        icon: 'clock',
        ...NOTIF_COLOR.planned,
        title: 'Client à rappeler',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: new Date(lead.updatedAt).getTime(),
        urgency: 'info',
        to: leadLink,
        reminderKey: reminderKey(lead),
      })
    }

    if (lead.status === 'nouveau' && new Date(lead.createdAt).getTime() >= in24h) {
      notifications.push({
        id: `new-lead-${lead.id}`,
        group: 'NOUVEAUX LEADS',
        icon: 'users',
        ...NOTIF_COLOR.newLead,
        title: 'Nouveau lead arrivé',
        body: <><strong>{name}</strong>{lead.city ? ` · ${lead.city}` : ''}{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: relativeTime(lead.createdAt),
        sortAt: new Date(lead.createdAt).getTime(),
        urgency: 'info',
        to: leadLink,
      })
    }
  }

  for (const rdv of rdvs) {
    if (rdv.status !== 'planifie') continue
    const scheduled = new Date(rdv.scheduledAt).getTime()
    if (scheduled > now && scheduled <= in10Min) {
      notifications.push({
        id: `rdv-soon-${rdv.id}`,
        group: 'DANS 10 MIN',
        icon: 'calendar',
        ...NOTIF_COLOR.rdvImminent,
        title: 'RDV dans moins de 10 minutes',
        body: <>Prépare le RDV {rdv.locationType} prévu à {formatDateTime(rdv.scheduledAt)}.</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: new Date(rdv.updatedAt).getTime(),
        urgency: 'soon',
        to: '/rdv',
      })
    }
  }

  return notifications.sort(notificationFeedRank)
}

export function buildCommercialNotifications(leads: LeadResponse[], rdvs: RdvResponse[]): Notif[] {
  const now = Date.now()
  const in10Min = now + 10 * 60 * 1000
  const in24h = now + 24 * 60 * 60 * 1000
  const since24h = now - 24 * 60 * 60 * 1000
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]))
  const notifications: Notif[] = []

  for (const rdv of rdvs) {
    const lead = leadMap.get(rdv.leadId)
    const name = lead ? fullName(lead) : 'Prospect'
    const scheduled = new Date(rdv.scheduledAt).getTime()
    const created = new Date(rdv.createdAt).getTime()
    const updated = new Date(rdv.updatedAt).getTime()
    const stage = commercialStageLabel(rdv, lead)
    const details = commercialRdvDetails(rdv, lead)

    if (rdv.status === 'planifie' && scheduled > now && scheduled <= in10Min) {
      notifications.push({
        id: `commercial-rdv-soon-${rdv.id}`,
        group: 'DANS 10 MIN',
        icon: 'calendar',
        ...NOTIF_COLOR.rdvImminent,
        title: 'RDV Planifié imminent',
        body: <><strong>{name}</strong>{details}</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: updated,
        urgency: 'soon',
        to: '/leads',
      })
    } else if (rdv.status === 'planifie' && scheduled > now && scheduled <= in24h) {
      notifications.push({
        id: `commercial-rdv-upcoming-${rdv.id}`,
        group: 'RDV À VENIR',
        icon: 'calendar',
        ...NOTIF_COLOR.rdvUpcoming,
        title: 'RDV Planifié',
        body: <><strong>{name}</strong>{details}</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: created,
        urgency: 'info',
        to: '/leads',
      })
    }

    if (created >= since24h) {
      notifications.push({
        id: `commercial-rdv-new-${rdv.id}`,
        group: 'NOUVEAUX RDV COMMERCIAL',
        icon: 'calendar',
        ...NOTIF_COLOR.rdvNew,
        title: 'Nouveau RDV attribué',
        body: <><strong>{name}</strong>{details}</>,
        time: relativeTime(rdv.createdAt),
        sortAt: created,
        urgency: 'info',
        to: '/leads',
      })
    } else if (updated >= since24h && stage !== 'RDV Planifié') {
      notifications.push({
        id: `commercial-pipeline-${rdv.id}`,
        group: 'PIPELINE COMMERCIAL',
        icon: 'chart',
        ...pipelineColors(stage),
        title: stage,
        body: <><strong>{name}</strong>{details}</>,
        time: relativeTime(rdv.updatedAt),
        sortAt: updated,
        urgency: 'info',
        to: '/leads',
      })
    }
  }

  return dedupeNotifications(notifications).sort(notificationFeedRank)
}

function commercialRdvDetails(rdv: RdvResponse, lead?: LeadResponse): React.ReactNode {
  const parts = [formatDateTime(rdv.scheduledAt)]
  if (lead?.phone) parts.push(lead.phone)
  if (lead?.city) parts.push(lead.city)
  if (rdv.montantTotal) parts.push(formatMoney(rdv.montantTotal))
  if (rdv.externalId) parts.push('GHL')
  return <> · {parts.join(' · ')}</>
}

function commercialStageLabel(rdv: RdvResponse, lead?: LeadResponse): string {
  if (rdv.result === 'signe' || lead?.status === 'signe') return '11. Devis Signé'
  if (rdv.result === 'perdu' || lead?.status === 'perdu') return '12. Devis Perdu'
  if (lead?.status === 'pas_qualifie') return '7. RDV Pas Qualifié'
  if (rdv.status === 'annule') return '6. RDV Annulé'
  if (rdv.status === 'no_show' || rdv.result === 'no_show') return '(BIS) No-Show'
  if (rdv.status === 'reporte' || rdv.result === 'reporte') return '8. RDV Reprogrammé'
  if (lead?.status === 'relance') return '9. Relance Long Terme'
  if (rdv.status === 'honore' || rdv.result === 'reflexion' || lead?.status === 'rdv_honore') return '10. Devis En Attente'
  return 'RDV Planifié'
}

// Palette de couleurs par type de notification — toutes différentes pour scan visuel rapide.
const NOTIF_COLOR = {
  // Rappel en retard → ROUGE alarmant
  late: {
    iconBg: 'bg-[#FEE2E2]',
    iconColor: 'text-[#DC2626]',
    borderColor: 'border-l-[#DC2626]',
  },
  // Rappel dans 10 min → AMBRE urgent
  imminent: {
    iconBg: 'bg-[#FEF3C7]',
    iconColor: 'text-[#D97706]',
    borderColor: 'border-l-[#D97706]',
  },
  // Rappel programmé → BLEU CIEL info
  planned: {
    iconBg: 'bg-[#E0F2FE]',
    iconColor: 'text-[#0284C7]',
    borderColor: 'border-l-[#0284C7]',
  },
  // Nouveau lead → ÉMERAUDE positif
  newLead: {
    iconBg: 'bg-[#D1FAE5]',
    iconColor: 'text-[#059669]',
    borderColor: 'border-l-[#059669]',
  },
  // RDV imminent (<10 min) → VIOLET attention
  rdvImminent: {
    iconBg: 'bg-[#EDE9FE]',
    iconColor: 'text-[#7C3AED]',
    borderColor: 'border-l-[#7C3AED]',
  },
  // RDV à venir (<24h) → INDIGO calme
  rdvUpcoming: {
    iconBg: 'bg-[#E0E7FF]',
    iconColor: 'text-[#4F46E5]',
    borderColor: 'border-l-[#4F46E5]',
  },
  // Nouveau RDV attribué → TEAL nouveau positif
  rdvNew: {
    iconBg: 'bg-[#CCFBF1]',
    iconColor: 'text-[#0D9488]',
    borderColor: 'border-l-[#0D9488]',
  },
  // Pipeline mouvement neutre (par défaut) → INDIGO doux
  pipelineNeutral: {
    iconBg: 'bg-[#E0E7FF]',
    iconColor: 'text-[#4F46E5]',
    borderColor: 'border-l-[#4F46E5]',
  },
  // Pipeline → Signé / vente conclue → ÉMERAUDE foncé win
  pipelineWin: {
    iconBg: 'bg-[#D1FAE5]',
    iconColor: 'text-[#047857]',
    borderColor: 'border-l-[#047857]',
  },
  // Pipeline → Perdu / Annulé / No-Show → ROUGE perte
  pipelineLoss: {
    iconBg: 'bg-[#FEE2E2]',
    iconColor: 'text-[#DC2626]',
    borderColor: 'border-l-[#DC2626]',
  },
  // Pipeline → Reprogrammé → AMBRE attention
  pipelineReschedule: {
    iconBg: 'bg-[#FEF3C7]',
    iconColor: 'text-[#D97706]',
    borderColor: 'border-l-[#D97706]',
  },
  // Pipeline → Pas qualifié → ROSE déception
  pipelineUnqualified: {
    iconBg: 'bg-[#FFE4E6]',
    iconColor: 'text-[#E11D48]',
    borderColor: 'border-l-[#E11D48]',
  },
} as const

function pipelineColors(stage: string): { iconBg: string; iconColor: string; borderColor: string } {
  if (stage.includes('Signé')) return NOTIF_COLOR.pipelineWin
  if (stage.includes('Perdu') || stage.includes('Annulé') || stage.includes('No-Show')) return NOTIF_COLOR.pipelineLoss
  if (stage.includes('Reprogrammé')) return NOTIF_COLOR.pipelineReschedule
  if (stage.includes('Pas Qualifié')) return NOTIF_COLOR.pipelineUnqualified
  return NOTIF_COLOR.pipelineNeutral
}

function dedupeNotifications(notifs: Notif[]): Notif[] {
  const seen = new Set<string>()
  return notifs.filter((notif) => {
    if (seen.has(notif.id)) return false
    seen.add(notif.id)
    return true
  })
}

function useMarkNotificationsSeen(notifs: Notif[]) {
  useEffect(() => {
    if (notifs.length === 0) return
    const seen = readSeenNotificationIds()
    let changed = false
    for (const notif of notifs) {
      if (seen.has(notif.id)) continue
      seen.add(notif.id)
      changed = true
    }
    if (!changed) return
    writeSeenNotificationIds(seen)
    window.dispatchEvent(new Event('ecoi:notifications-seen'))
  }, [notifs])
}

function readSeenNotificationIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('ecoi.seenNotificationIds') ?? '[]')) } catch { return new Set() }
}

function writeSeenNotificationIds(ids: Set<string>) {
  localStorage.setItem('ecoi.seenNotificationIds', JSON.stringify(Array.from(ids).slice(-5000)))
}

export function useBrowserNotifications(notifs: Notif[]) {
  useEffect(() => {
    if (!supportsBrowserNotifications() || Notification.permission !== 'granted') return
    const ids = readNotifiedIds()
    const urgent = notifs.filter((n) => n.urgency === 'now' || n.urgency === 'soon').slice(0, 5)
    for (const notif of urgent) {
      if (ids.has(notif.id)) continue
      ids.add(notif.id)
      showBrowserNotification(notif.title, notificationBody(notif), notif.id)
    }
    writeNotifiedIds(ids)
  }, [notifs])
}

export function useMinuteTicker(): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60000))
  useEffect(() => {
    const interval = window.setInterval(() => setTick(Math.floor(Date.now() / 60000)), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  return tick
}

export function showBrowserNotification(title: string, body?: string, tag?: string) {
  if (!supportsBrowserNotifications() || Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      body,
      tag,
      requireInteraction: true,
      silent: false,
    } as NotificationOptions)
  } catch {
    try { new Notification(title, { body, tag }) } catch { /* navigateur/OS bloque la notification */ }
  }
}

function notificationBody(notif: Notif): string {
  if (typeof notif.body === 'string') return notif.body
  return notif.time
}

function readNotifiedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('ecoi.notifiedIds') ?? '[]')) } catch { return new Set() }
}

function writeNotifiedIds(ids: Set<string>) {
  localStorage.setItem('ecoi.notifiedIds', JSON.stringify(Array.from(ids).slice(-100)))
}

function useCalledReminders(): [Set<string>, (ids: Set<string>) => void] {
  const [ids, setIds] = useState(() => readCalledReminderKeys())
  useEffect(() => {
    const refresh = () => setIds(readCalledReminderKeys())
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  return [ids, setIds]
}

function readCalledReminderKeys(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('ecoi.calledReminderKeys') ?? '[]')) } catch { return new Set() }
}

function writeCalledReminderKeys(ids: Set<string>) {
  localStorage.setItem('ecoi.calledReminderKeys', JSON.stringify(Array.from(ids).slice(-5000)))
}

function reminderKey(lead: LeadResponse): string {
  return `${lead.id}:${lead.nextCallbackAt ?? ''}`
}

// Détection auto "rappel déjà traité" — évite que le commercial doive cliquer
// "Barrer comme appelé" sur 50 leads qu'il a clairement déjà appelés.
//
// Conditions :
// - le lead a été appelé APRÈS l'heure du rappel (latestCallAt >= nextCallbackAt)
// - OU le statut a évolué hors de la file d'attente d'appels (qualifié, RDV, signé, perdu, pas qualifié)
function isCallbackResolved(lead: LeadResponse, callbackAt: number | null): boolean {
  const resolvedStatuses: LeadStatus[] = ['qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu', 'pas_qualifie']
  if (resolvedStatuses.includes(lead.status)) return true
  if (callbackAt && lead.latestCallAt) {
    const latestCall = new Date(lead.latestCallAt).getTime()
    if (Number.isFinite(latestCall) && latestCall >= callbackAt) return true
  }
  return false
}

// Feed chronologique style Facebook : tri pur par date d'apparition, plus récent en haut,
// tous types confondus. Chaque builder ci-dessus définit sortAt comme "quand la notif
// est entrée dans le feed" (createdAt du lead/rdv, updatedAt si plan modifié, callbackAt
// au moment où ça devient overdue) — jamais comme la date future d'un événement à venir.
function notificationFeedRank(a: Notif, b: Notif): number {
  const aTime = a.sortAt ?? 0
  const bTime = b.sortAt ?? 0
  if (aTime !== bTime) return bTime - aTime
  return a.title.localeCompare(b.title, 'fr')
}

function supportsBrowserNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!supportsBrowserNotifications()) return 'unsupported'
  return Notification.permission
}

async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!supportsBrowserNotifications()) return 'unsupported'
  return Notification.requestPermission()
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `aujourd'hui ${time}`
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`
}

function formatMoney(value: string | number): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  return formatDateTime(iso)
}
