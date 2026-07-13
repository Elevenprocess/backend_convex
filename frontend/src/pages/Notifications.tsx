import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon, type IconName } from '../components/Icon'
import { LoadingBlock, Spinner } from '../components/Spinner'
import { useLeads, useNotifications, useRdvList } from '../lib/hooks'
import { markNotificationRead } from '../lib/api'
import { notifyRealtimeRefresh } from '../lib/realtime'
import { useAuth } from '../lib/auth'
import { fullName, type LeadResponse, type LeadStatus, type NotificationResponse, type RdvResponse } from '../lib/types'
import { leadSearchPath } from '../lib/leadPaths'

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
  // true => le système a détecté que le rappel a déjà été traité (lead rappelé, même en avance).
  // La carte s'affiche barrée automatiquement, sans clic sur "Barrer comme appelé".
  resolved?: boolean
  /** For backend-persisted notifications: null = unread, string = already read */
  readAt?: string | null
  /** Callback to mark a persisted notification as read */
  onMarkRead?: () => void
}

export function Notifications() {
  const user = useAuth((s) => s.user)
  // isCommercial = vendeur individuel → scope = ses leads/RDV attribués.
  // isCommercialTeam = équipe closing (commercial + commercial_lead) → mêmes 3
  // notifs ; le lead n'a pas de filtre de scope donc reçoit toute l'équipe.
  const isCommercial = user?.role === 'commercial'
  const isCommercialTeam = isCommercial || user?.role === 'commercial_lead'
  const leadFilters = isCommercial && user?.id ? { assignedToId: user.id, limit: 250 } : { limit: 250 }
  const rdvFilters = isCommercial && user?.id ? { commercialId: user.id, limit: 200 } : { limit: 200 }
  const { data: leadsData, loading: leadsLoading } = useLeads(leadFilters)
  const { data: rdvsData, loading: rdvLoading } = useRdvList(rdvFilters)
  const { data: persistedData, loading: persistedLoading, refetch: refreshPersisted } = useNotifications({ limit: 50 })
  const leads = leadsData ?? []
  const rdvs = rdvsData ?? []
  const persisted = persistedData ?? []
  const minuteTick = useMinuteTicker()

  const handleMarkRead = useCallback((id: string) => {
    markNotificationRead(id).then(() => {
      notifyRealtimeRefresh({ event: 'notification:read', paths: ['/notifications'] })
      refreshPersisted()
    }).catch(() => { /* silently ignore — user can retry */ })
  }, [refreshPersisted])

  const notifs = useMemo(() => {
    const derived = isCommercialTeam ? buildCommercialNotifications(leads, rdvs) : buildNotifications(leads, rdvs)
    // Côté commercial, aucune notification persistée (VT, webhooks…) n'est affichée.
    const persistedNotifs = isCommercialTeam ? [] : buildPersistedNotifications(persisted, handleMarkRead)
    return dedupeNotifications([...derived, ...persistedNotifs]).sort(notificationFeedRank)
  }, [isCommercialTeam, leads, rdvs, persisted, handleMarkRead, minuteTick])

  const loading = leadsLoading || rdvLoading || persistedLoading
  const [permission, setPermission] = useState(notificationPermission())

  useBrowserNotifications(notifs)
  useMarkNotificationsSeen(notifs)

  return (
    <AppShell>
      <Topbar eyebrow="NOTIFICATIONS" title={isCommercialTeam ? 'Notifications commerciales' : 'Notifications et rappels'} />
      <div className="px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 flex items-center justify-between flex-shrink-0 gap-2 sm:gap-4 flex-wrap">
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

      <main className="p-3 sm:p-6 md:p-8 pt-3 sm:pt-4 max-w-3xl mx-auto w-full overflow-y-auto space-y-3 flex-grow">
        {loading && notifs.length === 0 ? (
          <LoadingBlock label="Chargement des notifications…" />
        ) : notifs.length === 0 ? (
          <div className="glass-card p-6 text-sm text-muted">
            {isCommercialTeam
              ? 'Aucune notification commerciale : pas de nouveau prospect qualifié, pas de RDV reporté à venir et pas de débrief à faire.'
              : 'Aucune notification urgente : pas de nouveau prospect récent, pas de rappel à traiter, pas de RDV imminent.'}
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
  // Barré = détecté automatiquement (lead rappelé, même en avance) OU barré à la main.
  const autoResolved = notif.resolved === true
  const manualCalled = notif.reminderKey ? calledReminders.has(notif.reminderKey) : false
  const isCalled = autoResolved || manualCalled
  const isRead = notif.readAt != null
  const toggleCalled = () => {
    if (!notif.reminderKey) return
    const next = new Set(calledReminders)
    if (next.has(notif.reminderKey)) next.delete(notif.reminderKey)
    else next.add(notif.reminderKey)
    writeCalledReminderKeys(next)
    setCalledReminders(next)
  }

  return (
    <div className={`glass-card p-4 flex items-start gap-4 ${notif.borderColor ? `border-l-4 ${notif.borderColor}` : ''} ${isCalled || isRead ? 'opacity-60' : ''}`}>
      <div className={`w-10 h-10 rounded-full ${notif.iconBg} flex items-center justify-center shrink-0`}>
        <Icon name={notif.icon} size={18} className={notif.iconColor} />
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex justify-between items-start gap-2">
          <span className={`font-semibold text-sm ${isCalled || isRead ? 'line-through text-muted' : ''}`}>{notif.title}</span>
          <span className="text-xs text-faint shrink-0">{notif.time}</span>
        </div>
        <p className={`text-sm text-muted mt-1 ${isCalled || isRead ? 'line-through' : ''}`}>{notif.body}</p>
        <div className="mt-3 flex items-center gap-2">
          {notif.to && <Link to={notif.to} className="text-xs font-semibold text-or-dark hover:underline">Ouvrir</Link>}
          {autoResolved ? (
            <span className="text-xs font-semibold rounded-full border border-success/40 bg-success-tint text-success px-3 py-1 inline-flex items-center gap-1">
              <Icon name="check" size={12} /> Déjà appelé
            </span>
          ) : notif.reminderKey && (
            <button
              type="button"
              onClick={toggleCalled}
              className={`text-xs font-semibold rounded-full border px-3 py-1 transition ${isCalled ? 'border-success/40 bg-success-tint text-success' : 'border-line bg-white/70 text-muted hover:border-or hover:text-text'}`}
            >
              {isCalled ? 'Rappel barré' : 'Barrer comme appelé'}
            </button>
          )}
          {notif.onMarkRead && !isRead && (
            <button
              type="button"
              onClick={notif.onMarkRead}
              className="text-xs font-semibold rounded-full border px-3 py-1 transition border-line bg-white/70 text-muted hover:border-or hover:text-text"
            >
              Marquer lu
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
    // buildNotifications est appelée pour les rôles non-commerciaux (setter, admin…).
    const leadLink = leadSearchPath(null, name)
    const callbackAt = lead.nextCallbackAt ? new Date(lead.nextCallbackAt).getTime() : null

    const callbackResolved = isCallbackResolved(lead, callbackAt)
    const isCallbackLead = lead.status === 'a_rappeler' || lead.status === 'relance' || lead.nextCallbackAt

    if (callbackAt && callbackResolved && isCallbackLead && resolvedCallbackStillVisible(lead, now)) {
      // Rappel déjà traité (lead rappelé, même en avance) → on le garde BARRÉ 24h puis il sort du feed.
      notifications.push({
        id: `callback-done-${lead.id}`,
        group: 'RAPPELS TRAITÉS',
        icon: 'check',
        ...NOTIF_COLOR.done,
        title: 'Appel à rappeler maintenant',
        body: <><strong>{name}</strong>{lead.phone ? ` · ${lead.phone}` : ''}</>,
        time: formatDateTime(lead.nextCallbackAt!),
        sortAt: new Date(lead.latestCallAt!).getTime(),
        urgency: 'info',
        to: leadLink,
        reminderKey: reminderKey(lead),
        resolved: true,
      })
    } else if (callbackAt && callbackAt <= now && (lead.status === 'a_rappeler' || lead.status === 'relance' || lead.nextCallbackAt) && !callbackResolved) {
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
        title: 'Nouveau prospect arrivé',
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

// Notifications de l'équipe closing (commercial + commercial_lead).
// Trois types seulement. Le périmètre est porté par les filtres de requête en
// amont : le commercial_lead reçoit toute l'équipe (leads/RDV non filtrés), le
// commercial individuel ne voit que ses leads/RDV attribués.
//   1. Nouveau prospect qualifié
//   2. Rappel de RDV reporté (à l'approche de la nouvelle date)
//   3. Débrief à faire (RDV honoré sans débrief rempli)
export function buildCommercialNotifications(leads: LeadResponse[], rdvs: RdvResponse[]): Notif[] {
  const now = Date.now()
  const in24h = now + 24 * 60 * 60 * 1000
  const since48h = now - 48 * 60 * 60 * 1000
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]))
  const notifications: Notif[] = []

  // 1) Nouveaux leads qualifiés (status 'qualifie', changement de stage récent).
  for (const lead of leads) {
    if (lead.status !== 'qualifie') continue
    const changedAt = lead.lastStageChangeAt ? new Date(lead.lastStageChangeAt).getTime() : new Date(lead.updatedAt).getTime()
    if (changedAt < since48h) continue
    const name = fullName(lead)
    notifications.push({
      id: `commercial-lead-qualified-${lead.id}`,
      group: 'NOUVEAUX LEADS QUALIFIÉS',
      icon: 'users',
      ...NOTIF_COLOR.newLead,
      title: 'Nouveau prospect qualifié',
      body: <><strong>{name}</strong>{commercialLeadDetails(lead)}</>,
      time: relativeTime(lead.lastStageChangeAt ?? lead.updatedAt),
      sortAt: changedAt,
      urgency: 'info',
      to: leadSearchPath(null, name),
    })
  }

  for (const rdv of rdvs) {
    const summary = rdv.lead ?? leadMap.get(rdv.leadId) ?? null
    const name = summary ? fullName(summary) : 'Prospect'
    const scheduled = new Date(rdv.scheduledAt).getTime()

    // 0) Signalement accueil : annulation / report transmis par le prospect sur
    // le numéro central (appel / WhatsApp). Alerte prioritaire, 7 jours.
    const alertAt = rdv.receptionAlertAt ? new Date(rdv.receptionAlertAt).getTime() : null
    if (alertAt && alertAt >= now - 7 * 24 * 60 * 60 * 1000) {
      const reason = rdv.cancelReason ? ` — ${rdv.cancelReason}` : ''
      const isCancel = rdv.receptionAlertKind === 'annule' || rdv.status === 'annule'
      if (isCancel) {
        notifications.push({
          id: `commercial-rdv-annule-${rdv.id}`,
          group: 'RDV ANNULÉS',
          icon: 'x',
          ...NOTIF_COLOR.late,
          title: 'RDV annulé par le prospect',
          body: <><strong>{name}</strong> · RDV du {formatDateTime(rdv.scheduledAt)} annulé{reason}</>,
          time: relativeTime(rdv.receptionAlertAt!),
          sortAt: alertAt,
          urgency: 'now',
          to: `/rdv/${rdv.id}`,
        })
      } else {
        const replanned = rdv.status === 'planifie'
        notifications.push({
          id: `commercial-rdv-report-accueil-${rdv.id}`,
          group: 'RDV REPORTÉS',
          icon: 'calendar',
          ...NOTIF_COLOR.rdvUpcoming,
          title: 'RDV reporté par le prospect',
          body: replanned
            ? <><strong>{name}</strong> · reporté au {formatDateTime(rdv.scheduledAt)}{reason}</>
            : <><strong>{name}</strong> · à replanifier{reason}</>,
          time: relativeTime(rdv.receptionAlertAt!),
          sortAt: alertAt,
          urgency: 'now',
          to: `/rdv/${rdv.id}`,
        })
      }
    }

    // 2) Rappel de RDV reporté — à l'approche de la nouvelle date (<24h).
    if (rdv.status === 'reporte' && scheduled > now && scheduled <= in24h) {
      notifications.push({
        id: `commercial-rdv-reporte-${rdv.id}`,
        group: 'RDV REPORTÉS',
        icon: 'calendar',
        ...NOTIF_COLOR.rdvUpcoming,
        title: 'Rappel : RDV reporté',
        body: <><strong>{name}</strong> · {formatDateTime(rdv.scheduledAt)}</>,
        time: formatDateTime(rdv.scheduledAt),
        sortAt: scheduled,
        urgency: 'soon',
        to: `/rdv/${rdv.id}`,
      })
    }

    // 3) Débrief à faire — RDV honoré dont le débrief n'est pas rempli.
    if (rdv.status === 'honore' && !rdv.debriefFilledAt) {
      notifications.push({
        id: `commercial-debrief-${rdv.id}`,
        group: 'DÉBRIEFS À FAIRE',
        icon: 'check',
        ...NOTIF_COLOR.rdvNew,
        title: 'Débrief à faire',
        body: <><strong>{name}</strong> · RDV honoré le {formatDateTime(rdv.scheduledAt)}</>,
        time: relativeTime(rdv.scheduledAt),
        sortAt: scheduled,
        urgency: 'info',
        to: `/rdv/${rdv.id}`,
      })
    }
  }

  return dedupeNotifications(notifications).sort(notificationFeedRank)
}

// Détails secondaires (ville · téléphone) d'un lead qualifié.
function commercialLeadDetails(lead: LeadResponse): React.ReactNode {
  const parts: string[] = []
  if (lead.city) parts.push(lead.city)
  if (lead.phone) parts.push(lead.phone)
  if (parts.length === 0) return null
  return <> · {parts.join(' · ')}</>
}

// ─── Notifs backend persistées (VT, webhooks, etc.) ──────────────────────────

type PersistedPayload = { clientId?: string; [key: string]: unknown }

function buildPersistedNotifications(
  items: NotificationResponse[],
  onMarkRead: (id: string) => void,
): Notif[] {
  return items.map((item) => {
    const payload = (item.payload ?? {}) as PersistedPayload
    const clientLink = payload.clientId ? `/clients/${payload.clientId}` : undefined
    const { iconBg, iconColor, borderColor } = persistedNotifColors(item.type)
    return {
      id: `persisted-${item.id}`,
      group: persistedNotifGroup(item.type),
      icon: persistedNotifIcon(item.type),
      iconBg,
      iconColor,
      borderColor,
      title: item.title,
      body: item.body ?? '',
      time: relativeTime(item.createdAt),
      sortAt: new Date(item.createdAt).getTime(),
      urgency: 'info' as const,
      to: clientLink,
      readAt: item.readAt,
      onMarkRead: item.readAt == null ? () => onMarkRead(item.id) : undefined,
    }
  })
}

function persistedNotifGroup(type: string): string {
  if (type.startsWith('vt')) return 'VISITES TECHNIQUES'
  if (type.startsWith('rdv')) return 'RDV'
  if (type.startsWith('lead')) return 'LEADS'
  return 'NOTIFICATIONS'
}

function persistedNotifIcon(type: string): IconName {
  if (type.startsWith('vt')) return 'calendar'
  if (type.startsWith('rdv')) return 'calendar'
  if (type.startsWith('lead')) return 'users'
  return 'bell'
}

function persistedNotifColors(type: string): { iconBg: string; iconColor: string; borderColor: string } {
  if (type.startsWith('vt')) return NOTIF_COLOR.rdvUpcoming
  if (type.startsWith('rdv')) return NOTIF_COLOR.rdvNew
  if (type.startsWith('lead')) return NOTIF_COLOR.newLead
  return NOTIF_COLOR.planned
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
  // Rappel déjà traité (appelé, même en avance) → VERT doux, carte barrée
  done: {
    iconBg: 'bg-[#DCFCE7]',
    iconColor: 'text-[#16A34A]',
    borderColor: 'border-l-[#16A34A]',
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
// - un appel PLUS RÉCENT que celui qui a posé le rappel existe (latestCallAt > callbackSetAt).
//   Couvre le cas "rappelé EN AVANCE" : le commercial appelle avant l'heure prévue du rappel,
//   donc latestCallAt reste < nextCallbackAt — mais il est > callbackSetAt, ce qui suffit.
// - OU (fallback, anciens leads sans callbackSetAt) le lead a été appelé APRÈS l'heure du rappel
// - OU le statut a évolué hors de la file d'attente d'appels (qualifié, RDV, signé, perdu, pas qualifié)
function isCallbackResolved(lead: LeadResponse, callbackAt: number | null): boolean {
  const resolvedStatuses: LeadStatus[] = ['qualifie', 'rdv_pris', 'rdv_honore', 'signe', 'perdu', 'pas_qualifie']
  if (resolvedStatuses.includes(lead.status)) return true
  if (lead.callbackSetAt && lead.latestCallAt) {
    const setAt = new Date(lead.callbackSetAt).getTime()
    const latestCall = new Date(lead.latestCallAt).getTime()
    // strictement > : si le rappel a été posé PAR le dernier appel, les deux sont égaux → non résolu.
    if (Number.isFinite(setAt) && Number.isFinite(latestCall) && latestCall > setAt) return true
  }
  if (callbackAt && lead.latestCallAt) {
    const latestCall = new Date(lead.latestCallAt).getTime()
    if (Number.isFinite(latestCall) && latestCall >= callbackAt) return true
  }
  return false
}

// Un rappel traité reste affiché BARRÉ pendant 24h (ancré sur l'heure de l'appel qui l'a résolu),
// puis sort du feed pour éviter l'accumulation de vieux rappels barrés.
function resolvedCallbackStillVisible(lead: LeadResponse, now: number): boolean {
  const calledAt = lead.latestCallAt ? new Date(lead.latestCallAt).getTime() : null
  if (calledAt && Number.isFinite(calledAt)) return calledAt >= now - 24 * 60 * 60 * 1000
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

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  return formatDateTime(iso)
}
