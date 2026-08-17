import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import { LoadingBlock, Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { useAuth } from '../lib/auth'
import { useConvexUsers } from '../lib/convexHooks'
import { useLeadSidebar } from '../lib/leadSidebar'
import { ROLE_LABELS } from '../lib/role'
import { DEFAULT_PERIOD, buildPeriodRange, type PeriodState } from '../lib/period'
import {
  activityLogList, activityLogMyScope,
  type ActivityDomain, type ActivityListArgs, type ConvexActivityDoc,
} from '../lib/convexApi'
import type { Role } from '../lib/types'
import {
  DOMAIN_META, DOMAIN_ORDER, ENTITY_META, ENTITY_ORDER,
  dayKey, dayTitle, detailRows, entityTarget, initialsOf, timeFmt, toCsv,
} from '../lib/journal'

const PAGE_SIZE = 60

// ─── Page ────────────────────────────────────────────────────────────────────

export function Journal() {
  const role = useAuth((s) => s.user?.role) as Role | undefined
  const [params, setParams] = useSearchParams()
  const scope = useQuery(activityLogMyScope, {})
  const { data: users } = useConvexUsers()

  const [period, setPeriod] = useState<PeriodState>({ ...DEFAULT_PERIOD, mode: 'this_week' })
  const [domain, setDomain] = useState<ActivityDomain | ''>((params.get('domain') as ActivityDomain) ?? '')
  const [actorId, setActorId] = useState<string>(params.get('actor') ?? '')
  const [entityType, setEntityType] = useState<string>(params.get('type') ?? '')
  const [searchInput, setSearchInput] = useState<string>(params.get('q') ?? '')
  const [search, setSearch] = useState<string>(params.get('q') ?? '')
  const leadId = params.get('lead') ?? undefined
  const clientId = params.get('client') ?? undefined
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const navigate = useNavigate()
  const selectLead = useLeadSidebar((s) => s.selectLead)

  // Clic sur une ligne : ouvre la page concernée avec le panneau du prospect
  // déjà sélectionné (liste prospects/clients + sidebar, ou page dossier).
  const openRow = (row: ConvexActivityDoc) => {
    const target = entityTarget(row, role)
    if (!target) return
    if (target.leadId) selectLead(target.leadId)
    navigate(target.path)
  }

  // Recherche débouncée (le search index tourne côté serveur).
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(h)
  }, [searchInput])

  // URL synchronisée (partage de vue « le journal de X ce mois-ci »).
  useEffect(() => {
    const next = new URLSearchParams(params)
    const setOrDelete = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k))
    setOrDelete('domain', domain)
    setOrDelete('actor', actorId)
    setOrDelete('type', entityType)
    setOrDelete('q', search)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, actorId, entityType, search])

  const range = buildPeriodRange(period)
  const args = useMemo<ActivityListArgs>(() => ({
    from: new Date(range.from).getTime(),
    to: new Date(range.to).getTime(),
    ...(domain ? { domain } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(leadId ? { leadId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(search ? { search } : {}),
  }), [range.from, range.to, domain, actorId, entityType, leadId, clientId, search])

  const { results, status, loadMore } = usePaginatedQuery(activityLogList, args, { initialNumItems: PAGE_SIZE })
  const loadingFirst = status === 'LoadingFirstPage'
  const canLoadMore = status === 'CanLoadMore'
  const loadingMore = status === 'LoadingMore'

  const visibleDomains = useMemo<ActivityDomain[]>(() => {
    if (!scope) return []
    if (scope.kind === 'own') return []
    return DOMAIN_ORDER.filter((d) => scope.domains.includes(d))
  }, [scope])

  const actorOptions = useMemo(() => {
    if (!scope || scope.kind === 'own') return []
    return (users ?? [])
      .filter((u) => u.active !== false)
      .slice()
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr'))
  }, [users, scope])

  const groups = useMemo(() => {
    const map = new Map<string, ConvexActivityDoc[]>()
    for (const r of results) {
      const k = dayKey(r.at)
      const arr = map.get(k)
      if (arr) arr.push(r)
      else map.set(k, [r])
    }
    return Array.from(map.entries())
  }, [results])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const resetFilters = () => {
    setDomain(''); setActorId(''); setEntityType(''); setSearchInput(''); setSearch('')
    const next = new URLSearchParams()
    setParams(next, { replace: true })
  }

  const exportCsv = () => {
    const blob = new Blob([toCsv(results)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `velora-historique-${dayKey(Date.now())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasFilters = Boolean(domain || actorId || entityType || search || leadId || clientId)
  const scopeHint = scope?.kind === 'own'
    ? 'Vous voyez uniquement vos propres actions.'
    : scope?.kind === 'domains'
      ? `Périmètre : ${scope.domains.map((d) => DOMAIN_META[d].label).join(', ')} + vos actions.`
      : null

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar eyebrow="ESPACE" title="Historique des actions" />
      <main className="journal-page flex-grow overflow-y-auto px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 pb-10">
        {/* Barre d'outils */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {visibleDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${domain === '' ? 'bg-or text-white' : 'bg-cream-darker text-muted hover:bg-line'}`}
                onClick={() => setDomain('')}
              >
                Tous
              </button>
              {visibleDomains.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${domain === d ? 'bg-or text-white' : 'bg-cream-darker text-muted hover:bg-line'}`}
                  onClick={() => setDomain(domain === d ? '' : d)}
                >
                  {DOMAIN_META[d].label}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <DateRangePicker value={period} onChange={setPeriod} align="right" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label className="relative flex-1 min-w-[220px] max-w-md">
            <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Rechercher (nom du prospect, action, mot-clé…)"
              className="w-full rounded-xl border border-line-soft bg-white/70 pl-8 pr-3 py-1.5 text-sm"
              aria-label="Rechercher dans l'historique"
            />
          </label>
          {actorOptions.length > 0 && (
            <select
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              className="rounded-xl border border-line-soft bg-white/70 px-3 py-1.5 text-sm font-semibold"
              aria-label="Filtrer par personne"
            >
              <option value="">Toute l'équipe</option>
              {actorOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email} · {ROLE_LABELS[u.role as Role] ?? u.role}
                </option>
              ))}
            </select>
          )}
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="rounded-xl border border-line-soft bg-white/70 px-3 py-1.5 text-sm font-semibold"
            aria-label="Filtrer par type"
          >
            <option value="">Tous les types</option>
            {ENTITY_ORDER.map((k) => (
              <option key={k} value={k}>{ENTITY_META[k].plural}</option>
            ))}
          </select>
          {hasFilters && (
            <button type="button" className="text-xs font-bold text-muted hover:text-rouille px-2" onClick={resetFilters}>
              Réinitialiser
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={results.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-or/30 bg-or-tint px-3 py-1.5 text-xs font-bold text-or-dark disabled:opacity-50"
            title="Exporter les lignes chargées en CSV"
          >
            <Icon name="download" size={14} />
            Export CSV
          </button>
        </div>

        <div className="text-xs text-faint mb-4 flex flex-wrap gap-x-3 gap-y-1">
          <span>
            {loadingFirst ? 'Chargement…' : `${results.length}${canLoadMore ? '+' : ''} action${results.length > 1 ? 's' : ''} · ${range.label}`}
          </span>
          {(leadId || clientId) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-or-tint text-or-dark px-2 py-0.5 font-bold">
              {leadId ? 'Prospect filtré' : 'Dossier filtré'}
              <button type="button" onClick={resetFilters} aria-label="Retirer le filtre" className="ml-1">✕</button>
            </span>
          )}
          {scopeHint && <span>{scopeHint}</span>}
        </div>

        {loadingFirst ? (
          <LoadingBlock label="Chargement de l'historique…" />
        ) : results.length === 0 ? (
          <div className="py-16">
            <EmptyState
              icon="clock"
              title="Aucune action sur cette période"
              description={hasFilters ? 'Essayez d’élargir la période ou de retirer un filtre.' : 'Les actions faites dans Velora apparaîtront ici, horodatées, dès qu’elles auront lieu.'}
              secondaryAction={hasFilters ? { label: 'Réinitialiser les filtres', onClick: resetFilters } : undefined}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(([key, rows]) => (
              <section key={key}>
                <h2 className="sticky top-0 z-10 -mx-1 px-1 py-1.5 mb-2 text-[11px] font-black uppercase tracking-wider text-faint bg-cream/85 backdrop-blur-sm">
                  {dayTitle(rows[0].at)} <span className="font-semibold normal-case tracking-normal">· {rows.length} action{rows.length > 1 ? 's' : ''}</span>
                </h2>
                <ol className="glass-card divide-y divide-line-soft overflow-hidden">
                  {rows.map((r) => (
                    <ActivityRow
                      key={r._id}
                      row={r}
                      role={role}
                      expanded={expanded.has(r._id)}
                      onToggle={() => toggle(r._id)}
                      onOpen={() => openRow(r)}
                    />
                  ))}
                </ol>
              </section>
            ))}
            {(canLoadMore || loadingMore) && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  className="btn-ghost inline-flex items-center gap-2"
                  disabled={loadingMore}
                  onClick={() => loadMore(PAGE_SIZE)}
                >
                  {loadingMore ? <Spinner size={14} stroke={3} color="currentColor" /> : <Icon name="download" size={14} />}
                  Charger plus
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </AppShell>
  )
}

// ─── Ligne ───────────────────────────────────────────────────────────────────

function ActivityRow({ row, role, expanded, onToggle, onOpen }: {
  row: ConvexActivityDoc
  role: Role | undefined
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const meta = DOMAIN_META[row.domain] ?? DOMAIN_META.system
  const target = entityTarget(row, role)
  const details = detailRows(row.details)
  const hasDetails = details.length > 0
  const isSystem = row.domain === 'system' && !row.actorId
  const roleLabel = row.actorRole ? (ROLE_LABELS[row.actorRole as Role] ?? row.actorRole) : null
  const clickable = Boolean(target)

  const handleKey = (e: React.KeyboardEvent) => {
    if (!clickable) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
  }

  return (
    <li
      className={`px-3 sm:px-4 py-2.5 transition-colors ${clickable ? 'cursor-pointer hover:bg-or-tint/40 focus-visible:bg-or-tint/40 outline-none' : ''}`}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={handleKey}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? (target?.leadId ? `Ouvrir ${row.subject ?? 'le prospect'}` : 'Ouvrir') : undefined}
    >
      <div className="flex items-start gap-3">
        <span className="w-12 shrink-0 pt-1 text-xs font-bold tabular-nums text-faint">{timeFmt.format(new Date(row.at))}</span>
        <span
          className={`mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${meta.cls}`}
          title={`${meta.label}${roleLabel ? ` · ${roleLabel}` : ''}`}
        >
          {isSystem ? <Icon name="settings" size={13} /> : initialsOf(row.actorName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-bold">{row.actorName}</span>
            {roleLabel && !isSystem && <span className="text-faint text-xs"> · {roleLabel}</span>}{' '}
            <span className="text-text">{row.summary}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`rounded-full px-2 py-0.5 font-bold ${meta.cls}`}>{meta.label}</span>
            <span className="rounded-full bg-cream-darker px-2 py-0.5 font-bold text-muted">
              {ENTITY_META[row.entityType]?.label ?? row.entityType}
            </span>
            {row.subject && target?.leadId && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line-soft px-2 py-0.5 font-bold text-or-dark">
                <Icon name="eye" size={11} />
                {row.subject}
              </span>
            )}
            {row.viaUserId && <span className="text-faint">(en mode « Explorer un profil »)</span>}
            {hasDetails && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggle() }}
                onKeyDown={(e) => e.stopPropagation()}
                className="ml-auto inline-flex items-center gap-1 text-faint hover:text-text font-bold"
              >
                {expanded ? 'Masquer' : 'Détails'}
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
            )}
          </div>
          {expanded && hasDetails && (
            <div className="mt-2 rounded-xl border border-line-soft bg-cream/60 px-3 py-2 text-xs" onClick={(e) => e.stopPropagation()}>
              <table className="w-full">
                <tbody>
                  {details.map((d, i) => (
                    <tr key={i} className="align-top">
                      <td className="pr-3 py-0.5 font-bold text-muted whitespace-nowrap">{d.label}</td>
                      {d.value !== undefined ? (
                        <td className="py-0.5 break-words" colSpan={3}>{d.value}</td>
                      ) : (
                        <>
                          <td className="py-0.5 text-faint line-through break-words">{d.before}</td>
                          <td className="px-2 py-0.5 text-faint">→</td>
                          <td className="py-0.5 font-semibold break-words">{d.after}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {clickable && <Icon name="chevron-right" size={16} className="mt-1.5 shrink-0 text-faint" />}
      </div>
    </li>
  )
}
