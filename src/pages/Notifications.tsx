import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon, type IconName } from '../components/Icon'
import { useLeads, useRdvList } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { fullName, type LeadResponse, type RdvResponse } from '../lib/types'

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
}

export function Notifications() {
  const user = useAuth((s) => s.user)
  const isCommercial = user?.role === 'commercial'
  const leadFilters = isCommercial && user?.id ? { assignedToId: user.id, limit: 2000 } : { limit: 2000 }
  const rdvFilters = isCommercial && user?.id ? { commercialId: user.id, limit: 200 } : { limit: 200 }
  const { data: leadsData, loading: leadsLoading } = useLeads(leadFilters)
  const { data: rdvsData, loading: rdvLoading } = useRdvList(rdvFilters)
  const leads = leadsData ?? []
  const rdvs = rdvsData ?? []
  const minuteTick = useMinuteTicker()
  const notifs = useMemo(() => (
    isCommercial ? buildCommercialNotifications(leads, rdvs) : buildNotifications(leads, rdvs)
  ), [isCommercial, leads, rdvs, minuteTick])
  const groups = Array.from(new Set(notifs.map((n) => n.group)))
  const loading = leadsLoading || rdvLoading
  const [permission, setPermission] = useState(notificationPermission())

  useBrowserNotifications(notifs)
  useMarkNotificationsSeen(notifs)

  return (
    <AppShell>
      <Topbar eyebrow="NOTIFICATIONS" title={isCommercial ? 'Notifications commerciales' : 'Notifications et rappels'} />
      <div className="px-8 pt-4 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="text-sm text-muted">
          {loading && notifs.length === 0 ? 'Chargement des notifications…' : `${notifs.length} notification${notifs.length > 1 ? 's' : ''} active${notifs.length > 1 ? 's' : ''}`}
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
        {notifs.length === 0 ? (
          <div className="glass-card p-6 text-sm text-muted">
            {isCommercial
              ? 'Aucune notification commerciale : pas de nouveau RDV, pas de RDV imminent et pas de mouvement pipeline récent.'
              : 'Aucune notification urgente : pas de nouveau lead récent, pas de rappel à traiter, pas de RDV imminent.'}
          </div>
        ) : isCommercial ? groups.map((g) => (
          <div key={g} className="space-y-3">
            <div className="text-xs eyebrow text-muted mt-4 first:mt-0">{g}</div>
            {notifs.filter((n) => n.group === g).map((n) => <NotificationCard key={n.id} notif={n} />)}
          </div>
        )) : (
          <div className="space-y-3">
            {notifs.map((n) => <NotificationCard key={n.id} notif={n} />)}
          </div>
        )}
      </main>
    </AppShell>
  )
}

function NotificationCard({ notif }: { notif: Notif }) {
  const content = (
    <>
      <div className={`w-10 h-10 rounded-full ${notif.iconBg} flex items-center justify-center shrink-0`}>
        <Icon name={notif.icon} size={18} className={notif.iconColor} />
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex justify-between items-start gap-2">
          <span className="font-semibold text-sm">{notif.title}</span>
          <span className="text-xs text-faint shrink-0">{notif.time}</span>
        </div>
        <p className="text-sm text-muted mt-1">{notif.body}</p>
      </div>
    </>
  )

  const className = `glass-card p-4 flex items-start gap-4 ${notif.borderColor ? `border-l-4 ${notif.borderColor}` : ''}`
  if (!notif.to) return <div className={className}>{content}</div>
  return <Link to={notif.to} className={`${className} hover:border-or transition-colors`}>{content}</Link>
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

    if (callbackAt && callbackAt <= now && (lead.status === 'a_rappeler' || lead.status === 'relance' || lead.nextCallbackAt)) {
      notifications.push({
        id: `callback-late-${lead.id}`,
        group: 'RAPPELS EN RETARD',
        icon: 'clock',
        iconBg: 'bg-rouille-tint',
        iconColor: 'text-rouille',
        borderColor: 'border-l-rouille',
        title: 'Appel à rappeler maintenant',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: callbackAt,
        urgency: 'now',
        to: leadLink,
      })
    } else if (callbackAt && callbackAt <= in10Min && callbackAt > now) {
      notifications.push({
        id: `callback-soon-${lead.id}`,
        group: 'DANS 10 MIN',
        icon: 'phone',
        iconBg: 'bg-cuivre-tint',
        iconColor: 'text-cuivre',
        borderColor: 'border-l-cuivre',
        title: 'Rappel téléphonique imminent',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: callbackAt,
        urgency: 'soon',
        to: leadLink,
      })
    } else if (callbackAt && lead.status === 'a_rappeler') {
      notifications.push({
        id: `callback-planned-${lead.id}`,
        group: 'RAPPELS PROGRAMMÉS',
        icon: 'clock',
        iconBg: 'bg-or-tint',
        iconColor: 'text-or-dark',
        borderColor: 'border-l-or',
        title: 'Client à rappeler',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: callbackAt,
        urgency: 'info',
        to: leadLink,
      })
    }

    if (lead.status === 'nouveau' && new Date(lead.createdAt).getTime() >= in24h) {
      notifications.push({
        id: `new-lead-${lead.id}`,
        group: 'NOUVEAUX LEADS',
        icon: 'users',
        iconBg: 'bg-success-tint',
        iconColor: 'text-success',
        borderColor: 'border-l-success',
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
        iconBg: 'bg-or-tint',
        iconColor: 'text-or-dark',
        borderColor: 'border-l-or',
        title: 'RDV dans moins de 10 minutes',
        body: <>Prépare le RDV {rdv.locationType} prévu à {formatDateTime(rdv.scheduledAt)}.</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: scheduled,
        urgency: 'soon',
        to: '/rdv',
      })
    }
  }

  return notifications.sort(setterRawRank)
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
        iconBg: 'bg-or-tint',
        iconColor: 'text-or-dark',
        borderColor: 'border-l-or',
        title: 'RDV Planifié imminent',
        body: <><strong>{name}</strong>{details}</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: scheduled,
        urgency: 'soon',
        to: '/leads',
      })
    } else if (rdv.status === 'planifie' && scheduled > now && scheduled <= in24h) {
      notifications.push({
        id: `commercial-rdv-upcoming-${rdv.id}`,
        group: 'RDV À VENIR',
        icon: 'calendar',
        iconBg: 'bg-or-tint',
        iconColor: 'text-or-dark',
        borderColor: 'border-l-or',
        title: 'RDV Planifié',
        body: <><strong>{name}</strong>{details}</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: scheduled,
        urgency: 'info',
        to: '/leads',
      })
    }

    if (created >= since24h) {
      notifications.push({
        id: `commercial-rdv-new-${rdv.id}`,
        group: 'NOUVEAUX RDV COMMERCIAL',
        icon: 'calendar',
        iconBg: 'bg-success-tint',
        iconColor: 'text-success',
        borderColor: 'border-l-success',
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
        iconBg: pipelineIconBg(stage),
        iconColor: pipelineIconColor(stage),
        borderColor: pipelineBorder(stage),
        title: stage,
        body: <><strong>{name}</strong>{details}</>,
        time: relativeTime(rdv.updatedAt),
        sortAt: updated,
        urgency: 'info',
        to: '/leads',
      })
    }
  }

  return dedupeNotifications(notifications).sort((a, b) => urgencyRank(a) - urgencyRank(b))
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

function pipelineIconBg(stage: string): string {
  if (stage.includes('Signé')) return 'bg-success-tint'
  if (stage.includes('Perdu') || stage.includes('Annulé') || stage.includes('No-Show')) return 'bg-cuivre-tint'
  return 'bg-or-tint'
}

function pipelineIconColor(stage: string): string {
  if (stage.includes('Signé')) return 'text-success'
  if (stage.includes('Perdu') || stage.includes('Annulé') || stage.includes('No-Show')) return 'text-cuivre'
  return 'text-or-dark'
}

function pipelineBorder(stage: string): string {
  if (stage.includes('Signé')) return 'border-l-success'
  if (stage.includes('Perdu') || stage.includes('Annulé') || stage.includes('No-Show')) return 'border-l-cuivre'
  return 'border-l-or'
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

function setterRawRank(a: Notif, b: Notif): number {
  const aTime = a.sortAt ?? 0
  const bTime = b.sortAt ?? 0
  if (aTime !== bTime) return bTime - aTime
  return a.title.localeCompare(b.title, 'fr')
}

function urgencyRank(notif: Notif): number {
  const groupRank = notif.group === 'RAPPELS EN RETARD' ? 0 : notif.group === 'DANS 10 MIN' ? 1 : notif.group === 'RDV À VENIR' ? 2 : notif.group === 'NOUVEAUX RDV COMMERCIAL' ? 3 : notif.group === 'NOUVEAUX LEADS' ? 4 : 5
  return groupRank * 10 + (notif.urgency === 'now' ? 0 : notif.urgency === 'soon' ? 1 : 2)
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
