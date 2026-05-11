import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon, type IconName } from '../components/Icon'
import { useLeadsProgressive, useRdvListProgressive } from '../lib/hooks'
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
  // Sort key: event timestamp (lead.createdAt, nextCallbackAt, scheduledAt).
  // Most recent first → top of the feed.
  timestamp: number
  urgency: 'now' | 'soon' | 'info'
  // `handled = true` quand l'utilisateur a déjà fait quelque chose côté lead
  // (call log enregistré APRÈS l'événement déclencheur). Affiche un check.
  handled: boolean
  to?: string
}

const INITIAL_PAGE_SIZE = 20
const PAGE_INCREMENT = 20
const LOAD_DELAY_MS = 200

export function Notifications() {
  // Two-phase fetch : 50 leads + 100 RDV peignent l'écran tout de suite,
  // puis 500 leads + 1000 RDV hydratent le reste en arrière-plan.
  const leadsState = useLeadsProgressive({ quickLimit: 50, fullLimit: 500 })
  const rdvsState = useRdvListProgressive({ quickLimit: 100, fullLimit: 1000 })
  const leads = leadsState.data ?? []
  const rdvs = rdvsState.data ?? []
  const notifs = useMemo(() => buildNotifications(leads, rdvs), [leads, rdvs])
  const initialLoading = leadsState.loading || rdvsState.loading
  const backgroundLoading = leadsState.backgroundLoading || rdvsState.backgroundLoading
  const [permission, setPermission] = useState(notificationPermission())
  const [visibleCount, setVisibleCount] = useState(INITIAL_PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const visibleNotifs = useMemo(() => notifs.slice(0, visibleCount), [notifs, visibleCount])
  const hasMore = visibleCount < notifs.length

  useBrowserNotifications(notifs)

  useEffect(() => {
    if (!hasMore) return
    const target = sentinelRef.current
    if (!target) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || loadingMore) return
      setLoadingMore(true)
      window.setTimeout(() => {
        setVisibleCount((c) => c + PAGE_INCREMENT)
        setLoadingMore(false)
      }, LOAD_DELAY_MS)
    }, { rootMargin: '300px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadingMore])

  return (
    <AppShell>
      <Topbar eyebrow="NOTIFICATIONS" title="Notifications et rappels" />
      <div className="px-8 pt-4 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="text-sm text-muted">
          {initialLoading
            ? 'Chargement des notifications…'
            : `${notifs.length} notification${notifs.length > 1 ? 's' : ''} active${notifs.length > 1 ? 's' : ''}${hasMore ? ` · ${visibleCount} affichées` : ''}${backgroundLoading ? ' · synchronisation…' : ''}`}
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
        {initialLoading && notifs.length === 0 ? (
          <div className="glass-card p-6 text-sm text-muted">Chargement des notifications…</div>
        ) : notifs.length === 0 ? (
          <div className="glass-card p-6 text-sm text-muted">Aucune notification urgente : pas de nouveau lead récent, pas de rappel à traiter, pas de RDV imminent.</div>
        ) : (
          <>
            {visibleNotifs.map((n) => <NotificationCard key={n.id} notif={n} />)}
            {hasMore && (
              <div ref={sentinelRef} className="glass-card p-4 text-center text-xs text-faint">
                {loadingMore ? 'Chargement des notifications suivantes…' : 'Continue à descendre pour voir la suite'}
              </div>
            )}
            {!hasMore && backgroundLoading && (
              <div className="glass-card p-4 text-center text-xs text-faint">Mise à jour en arrière-plan…</div>
            )}
          </>
        )}
      </main>
    </AppShell>
  )
}

function NotificationCard({ notif }: { notif: Notif }) {
  const content = (
    <>
      <div className={`relative w-10 h-10 rounded-full ${notif.iconBg} flex items-center justify-center shrink-0`}>
        <Icon name={notif.icon} size={18} className={notif.iconColor} />
        {notif.handled && (
          <span
            title="Lead déjà contacté"
            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-success text-white border-2 border-white flex items-center justify-center"
          >
            <Icon name="check" size={10} className="stroke-[3]" />
          </span>
        )}
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex justify-between items-start gap-2">
          <span className={`font-semibold text-sm ${notif.handled ? 'text-faint line-through decoration-1' : ''}`}>{notif.title}</span>
          <span className="text-xs text-faint shrink-0">{notif.time}</span>
        </div>
        <p className={`text-sm mt-1 ${notif.handled ? 'text-faint' : 'text-muted'}`}>{notif.body}</p>
      </div>
    </>
  )

  const opacity = notif.handled ? 'opacity-70' : ''
  const className = `glass-card p-4 flex items-start gap-4 ${notif.borderColor ? `border-l-4 ${notif.borderColor}` : ''} ${opacity}`
  if (!notif.to) return <div className={className}>{content}</div>
  return <Link to={notif.to} className={`${className} hover:border-or transition-colors`}>{content}</Link>
}

export function buildNotifications(leads: LeadResponse[], rdvs: RdvResponse[]): Notif[] {
  const now = Date.now()
  const in10Min = now + 10 * 60 * 1000
  const in24hPast = now - 24 * 60 * 60 * 1000
  const in24hFuture = now + 24 * 60 * 60 * 1000
  const notifications: Notif[] = []

  for (const lead of leads) {
    const name = fullName(lead)
    const leadLink = `/leads?search=${encodeURIComponent(name)}`
    const callbackAt = lead.nextCallbackAt ? new Date(lead.nextCallbackAt).getTime() : null
    const lastContactAt = lead.lastContactAt ? new Date(lead.lastContactAt).getTime() : null

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
        timestamp: callbackAt,
        urgency: 'now',
        handled: lastContactAt != null && lastContactAt >= callbackAt,
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
        timestamp: callbackAt,
        urgency: 'soon',
        handled: lastContactAt != null && lastContactAt >= callbackAt - 10 * 60 * 1000,
        to: leadLink,
      })
    } else if (callbackAt && lead.status === 'a_rappeler' && callbackAt <= in24hFuture) {
      // Fenêtre de 24h max : un rappel programmé dans 11 jours ne pollue plus la liste.
      // `handled` = contact dans la dernière heure (le commercial vient probablement d'appeler).
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
        timestamp: callbackAt,
        urgency: 'info',
        handled: lastContactAt != null && lastContactAt >= now - 60 * 60 * 1000,
        to: leadLink,
      })
    }

    if (lead.status === 'nouveau' && new Date(lead.createdAt).getTime() >= in24hPast) {
      const createdAt = new Date(lead.createdAt).getTime()
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
        timestamp: createdAt,
        urgency: 'info',
        handled: lastContactAt != null && lastContactAt >= createdAt,
        to: leadLink,
      })
    }

    if (lead.status === 'qualifie' && new Date(lead.updatedAt).getTime() >= in24hPast) {
      const updatedAt = new Date(lead.updatedAt).getTime()
      notifications.push({
        id: `qualified-${lead.id}`,
        group: 'LEADS QUALIFIÉS',
        icon: 'eye',
        iconBg: 'bg-or-tint',
        iconColor: 'text-or-dark',
        borderColor: 'border-l-or',
        title: 'Lead qualifié',
        body: <><strong>{name}</strong>{lead.city ? ` · ${lead.city}` : ''}{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: relativeTime(lead.updatedAt),
        timestamp: updatedAt,
        urgency: 'info',
        handled: lastContactAt != null && lastContactAt >= updatedAt,
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
        timestamp: scheduled,
        urgency: 'soon',
        handled: false,
        to: '/rdv',
      })
    }
  }

  // Tri "feed" : la notif la plus récente en haut.
  // Pour les events futurs (RDV imminent, callback programmé), on plafonne à `now`
  // pour éviter qu'un RDV dans 2 semaines passe devant un nouveau lead arrivé à l'instant.
  return notifications.sort((a, b) => Math.min(b.timestamp, now) - Math.min(a.timestamp, now))
}

function useBrowserNotifications(notifs: Notif[]) {
  useEffect(() => {
    if (!supportsBrowserNotifications() || Notification.permission !== 'granted') return
    const ids = readNotifiedIds()
    const urgent = notifs.filter((n) => n.urgency === 'now' || n.urgency === 'soon').slice(0, 5)
    for (const notif of urgent) {
      if (ids.has(notif.id)) continue
      ids.add(notif.id)
      new Notification(notif.title, { body: notificationBody(notif), tag: notif.id })
    }
    writeNotifiedIds(ids)
  }, [notifs])
}

function notificationBody(notif: Notif): string {
  if (typeof notif.body === 'string') return notif.body
  return `${notif.group} · ${notif.time}`
}

function readNotifiedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('ecoi.notifiedIds') ?? '[]')) } catch { return new Set() }
}

function writeNotifiedIds(ids: Set<string>) {
  localStorage.setItem('ecoi.notifiedIds', JSON.stringify(Array.from(ids).slice(-100)))
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

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  return formatDateTime(iso)
}
