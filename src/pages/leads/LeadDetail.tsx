import { useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon, type IconName } from '../../components/Icon'
import { LoadingBlock } from '../../components/Spinner'
import { useLead, useRdvList, useCallLogs, useUsers, useStartCall } from '../../lib/hooks'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  CALL_RESULT_LABEL,
  cleanField,
  fullName,
  initials as leadInitials,
  type LeadResponse,
  type RdvResponse,
  type CallLogResponse,
  type UserResponse,
} from '../../lib/types'

type TimelineItem = {
  icon: IconName
  iconBg: string
  iconColor: string
  title: string
  date: string
  desc?: string
}

export function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const startCall = useStartCall()

  const { data: lead, loading, error } = useLead(id)
  const { data: rdvs } = useRdvList(id ? { leadId: id, limit: 50 } : undefined)
  const { data: calls } = useCallLogs(id ? { leadId: id, limit: 50 } : undefined)
  const { data: users } = useUsers()

  const userMap = useMemo(() => {
    const m = new Map<string, UserResponse>()
    for (const u of users ?? []) m.set(u.id, u)
    return m
  }, [users])

  if (loading) {
    return (
      <AppShell>
        <Topbar eyebrow="LEADS / DÉTAIL" title="Chargement…" />
        <main className="p-8 flex items-center justify-center flex-grow">
          <LoadingBlock label="Chargement du lead…" />
        </main>
      </AppShell>
    )
  }

  if (error || !lead) {
    return (
      <AppShell>
        <Topbar eyebrow="LEADS / DÉTAIL" title="Lead introuvable" />
        <main className="p-8 flex items-center justify-center flex-grow">
          <div className="glass-card p-12 text-center">
            <p className="text-muted mb-4">{error ?? "Ce lead n'existe pas (ou plus)."}</p>
            <Link to="/leads" className="btn-primary inline-block px-4 py-2 rounded-xl text-sm">Retour à la liste</Link>
          </div>
        </main>
      </AppShell>
    )
  }

  const setter = lead.setterId ? userMap.get(lead.setterId) : undefined
  const commercial = lead.assignedToId ? userMap.get(lead.assignedToId) : undefined

  const timeline = buildTimeline(rdvs ?? [], calls ?? [], userMap)

  return (
    <AppShell>
      <Topbar
        eyebrow="LEADS / DÉTAIL"
        title={fullName(lead)}
      />
      <div className="px-8 pt-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/leads')}
          className="text-muted hover:text-text flex items-center gap-1 text-sm"
        >
          <Icon name="arrow-left" size={16} />
          Retour
        </button>
        <div className="flex items-center gap-3 ml-auto">
          <button className="px-4 py-2 rounded-[14px] text-sm font-semibold border border-line bg-white flex items-center gap-2">
            <Icon name="mail" size={14} />
            Email
          </button>
          <button className="px-4 py-2 rounded-[14px] text-sm font-semibold border border-line bg-white flex items-center gap-2">
            <Icon name="edit" size={14} />
            Note
          </button>
          <button
            onClick={() => {
              const phone = cleanField(lead.phone)
              if (!phone) return
              startCall({ leadId: lead.id, leadName: fullName(lead), toNumber: phone }).catch((e) => {
                console.error('Phone copy failed', e)
                alert(e instanceof Error ? e.message : 'Impossible de copier le numéro')
              })
            }}
            disabled={!cleanField(lead.phone)}
            className="btn-primary px-5 py-2 rounded-[14px] text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Icon name="phone" size={14} />
            Appeler
          </button>
        </div>
      </div>

      <main className="p-8 pt-4 grid grid-cols-3 gap-6 overflow-y-auto flex-grow">
        {/* Left col */}
        <div className="col-span-1 space-y-6">
          <div className="glass-card p-6 text-center">
            <div className="w-24 h-24 rounded-full bg-cuivre-tint flex items-center justify-center text-3xl font-bold mx-auto mb-4">{leadInitials(lead)}</div>
            <h3 className="text-xl font-bold">{fullName(lead)}</h3>
            <span className={`status-badge ${STATUS_BADGE[lead.status]} mt-2 inline-block`}>{STATUS_LABEL[lead.status]}</span>
            <div className="mt-4 space-y-2 text-sm text-muted">
              {cleanField(lead.phone) && <div className="flex items-center justify-center gap-2"><Icon name="phone" size={14} /> {cleanField(lead.phone)}</div>}
              {cleanField(lead.email) && <div className="flex items-center justify-center gap-2"><Icon name="mail" size={14} /> {cleanField(lead.email)}</div>}
              {cleanField(lead.city) && <div className="flex items-center justify-center gap-2"><Icon name="map-pin" size={14} /> {cleanField(lead.city)}</div>}
            </div>
          </div>

          <div className="glass-card p-6">
            <span className="eyebrow block mb-3">ATTRIBUTION</span>
            <div className="space-y-3 text-sm">
              <Row label="Setter">
                {setter
                  ? <PersonChip name={setter.name} tint="bg-cuivre-tint" />
                  : <span className="text-faint">Non assigné</span>}
              </Row>
              <Row label="Commercial">
                {commercial
                  ? <PersonChip name={commercial.name} tint="bg-or-tint" />
                  : <span className="text-faint">Non assigné</span>}
              </Row>
              <Row label="Source"><span className="font-semibold">{prettySource(lead)}</span></Row>
              {lead.utmSource && <Row label="UTM"><span className="font-mono text-xs">{lead.utmSource}</span></Row>}
              <Row label="Créé le"><span className="font-semibold">{formatDate(lead.createdAt)}</span></Row>
              <Row label="Dernier contact"><span className="font-semibold">{lastContactLabel(lead.joursSansContact)}</span></Row>
            </div>
          </div>
        </div>

        {/* Right col */}
        <div className="col-span-2 space-y-6">
          <div className="glass-card p-6">
            <h3 className="font-bold mb-4">Historique</h3>
            {timeline.length === 0 ? (
              <p className="text-sm text-faint">Aucun événement enregistré pour ce lead.</p>
            ) : (
              <div className="space-y-4">
                {timeline.map((t, i) => (
                  <div key={i} className="flex gap-3">
                    <div className={`w-8 h-8 rounded-full ${t.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon name={t.icon} size={14} className={t.iconColor} />
                    </div>
                    <div className="flex-grow">
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold text-sm">{t.title}</span>
                        <span className="text-xs text-faint shrink-0">{t.date}</span>
                      </div>
                      {t.desc && <p className="text-xs text-muted mt-1">{t.desc}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  )
}

function buildTimeline(
  rdvs: RdvResponse[],
  calls: CallLogResponse[],
  userMap: Map<string, UserResponse>,
): TimelineItem[] {
  const items: (TimelineItem & { sortKey: number })[] = []

  for (const r of rdvs) {
    const com = r.commercialId ? (userMap.get(r.commercialId)?.name ?? 'commercial') : 'commercial non assigné'
    const scheduledLabel = r.scheduledAt ? formatDateTime(r.scheduledAt) : 'Date RDV manquante'
    items.push({
      icon: 'calendar',
      iconBg: 'bg-success-tint',
      iconColor: 'text-success',
      title: r.result === 'signe' ? 'RDV signé' : r.status === 'honore' ? 'RDV honoré' : r.status === 'no_show' ? 'RDV no-show' : 'RDV programmé',
      date: scheduledLabel,
      desc: `Avec ${com} — ${r.locationType}${r.montantTotal ? ` · ${Number(r.montantTotal).toLocaleString('fr-FR')} €` : ''}${r.notes ? ` · ${r.notes}` : ''}`,
      sortKey: r.scheduledAt ? new Date(r.scheduledAt).getTime() : (r.signatureAt ? new Date(r.signatureAt).getTime() : 0),
    })
  }

  for (const c of calls) {
    items.push({
      icon: 'phone',
      iconBg: 'bg-cuivre-tint',
      iconColor: 'text-cuivre',
      title: `Appel — ${CALL_RESULT_LABEL[c.result]}`,
      date: formatDateTime(c.calledAt),
      desc: c.notes ?? undefined,
      sortKey: new Date(c.calledAt).getTime(),
    })
  }

  items.sort((a, b) => b.sortKey - a.sortKey)
  return items.map(({ sortKey: _sortKey, ...rest }) => rest)
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

function lastContactLabel(j: number | null): string {
  if (j === null) return 'Jamais'
  if (j === 0) return "Aujourd'hui"
  if (j === 1) return 'Hier'
  return `Il y a ${j}j`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-faint">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}

function PersonChip({ name, tint }: { name: string; tint: string }) {
  const parts = name.split(' ').filter(Boolean)
  const inits = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··'
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full ${tint} flex items-center justify-center text-[10px] font-bold`}>{inits}</div>
      <span className="font-semibold">{name}</span>
    </div>
  )
}
