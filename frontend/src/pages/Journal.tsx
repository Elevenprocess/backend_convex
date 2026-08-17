import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { Icon } from '../components/Icon'
import { LoadingBlock, Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { useAuth } from '../lib/auth'
import { useConvexActivityLog, useConvexActivityScope, useConvexUsers } from '../lib/convexHooks'
import { useLeadSidebar } from '../lib/leadSidebar'
import { ROLE_LABELS } from '../lib/role'
import { DEFAULT_PERIOD, buildPeriodRange, type PeriodState } from '../lib/period'
import type { ActivityDomain, ActivityListArgs, ConvexActivityDoc } from '../lib/convexApi'
import type { Role } from '../lib/types'
import {
  DOMAIN_META, DOMAIN_ORDER, ENTITY_META,
  dayKey, dayTitle, detailRows, entityTarget, initialsOf, timeFmt,
} from '../lib/journal'


// ─── Page ────────────────────────────────────────────────────────────────────

// Filtre « Type » : famille de rôle de l'auteur de l'action.
const ACTOR_TYPES = {
  setter: { label: 'Setter', roles: ['setter', 'setter_lead'] },
  commercial: { label: 'Commercial', roles: ['commercial', 'commercial_lead'] },
  delivrabilite: { label: 'Délivrabilité', roles: ['delivrabilite', 'responsable_technique', 'back_office', 'technicien'] },
} as const
type ActorType = keyof typeof ACTOR_TYPES | ''
const isActorType = (v: string | null): v is ActorType => v === '' || (v !== null && v in ACTOR_TYPES)

// Famille de rôle → couleur (setters = vert, commerciaux = cuivre, délivrabilité = succès).
function roleFamily(role: Role | undefined): 'setter' | 'commercial' | 'delivrabilite' | 'other' {
  if (role === 'setter' || role === 'setter_lead') return 'setter'
  if (role === 'commercial' || role === 'commercial_lead') return 'commercial'
  if (role === 'delivrabilite' || role === 'responsable_technique' || role === 'back_office' || role === 'technicien') return 'delivrabilite'
  return 'other'
}

function normalizeText(v: string): string {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

export function Journal() {
  const role = useAuth((s) => s.user?.role) as Role | undefined
  const [params, setParams] = useSearchParams()
  const scope = useConvexActivityScope()
  const { data: users } = useConvexUsers()

  const [period, setPeriod] = useState<PeriodState>({ ...DEFAULT_PERIOD, mode: 'this_week' })
  const [domain, setDomain] = useState<ActivityDomain | ''>((params.get('domain') as ActivityDomain) ?? '')
  const [actorId, setActorId] = useState<string>(params.get('actor') ?? '')
  const [actorType, setActorType] = useState<ActorType>(isActorType(params.get('type')) ? (params.get('type') as ActorType) : '')
  const [searchInput, setSearchInput] = useState<string>(params.get('q') ?? '')
  const [search, setSearch] = useState<string>(params.get('q') ?? '')
  const [memberQuery, setMemberQuery] = useState('')
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

  // Recherche (locale, sur les lignes chargées) légèrement débouncée.
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim()), 120)
    return () => clearTimeout(h)
  }, [searchInput])

  // URL synchronisée (partage de vue « le journal de X ce mois-ci »).
  useEffect(() => {
    const next = new URLSearchParams(params)
    const setOrDelete = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k))
    setOrDelete('domain', domain)
    setOrDelete('actor', actorId)
    setOrDelete('type', actorType)
    setOrDelete('q', search)
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, actorId, actorType, search])

  const range = buildPeriodRange(period)
  // Seule la PÉRIODE (et le ciblage prospect/dossier) va au serveur : les
  // autres filtres sont appliqués localement sur les lignes chargées, donc
  // chaque clic dans la sidebar est instantané.
  const args = useMemo<ActivityListArgs>(() => ({
    from: new Date(range.from).getTime(),
    to: new Date(range.to).getTime(),
    ...(leadId ? { leadId } : {}),
    ...(clientId ? { clientId } : {}),
  }), [range.from, range.to, leadId, clientId])

  const { rows: loaded, loading: loadingFirst, fromCache, canLoadMore, loadingMore, loadMore } = useConvexActivityLog(args)

  const results = useMemo(() => {
    const roles = actorType ? (ACTOR_TYPES[actorType].roles as readonly string[]) : null
    const q = normalizeText(search)
    return loaded.filter((r) => {
      if (domain && r.domain !== domain) return false
      if (actorId && r.actorId !== actorId) return false
      if (roles && !roles.includes(r.actorRole ?? '')) return false
      if (q && !normalizeText(`${r.actorName} ${r.subject ?? ''} ${r.summary}`).includes(q)) return false
      return true
    })
  }, [loaded, domain, actorId, actorType, search])

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

  const visibleActors = useMemo(() => {
    const q = memberQuery.trim().toLowerCase()
    if (!q) return actorOptions
    return actorOptions.filter((u) => `${u.name ?? ''} ${u.email ?? ''} ${ROLE_LABELS[u.role as Role] ?? ''}`.toLowerCase().includes(q))
  }, [actorOptions, memberQuery])
  const selectedActor = actorOptions.find((u) => u.id === actorId)

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
    setDomain(''); setActorId(''); setActorType(''); setSearchInput(''); setSearch('')
    const next = new URLSearchParams()
    setParams(next, { replace: true })
  }

  const hasFilters = Boolean(domain || actorId || actorType || search || leadId || clientId)
  const scopeHint = scope?.kind === 'own'
    ? 'Vous voyez uniquement vos propres actions.'
    : scope?.kind === 'domains'
      ? `Périmètre : ${scope.domains.map((d) => DOMAIN_META[d].label).join(', ')} + vos actions.`
      : null

  if (role === 'commercial_lead') return <Navigate to="/overview" replace />

  return (
    <AppShell blobsKey="admin" flat>
      <Topbar eyebrow="ESPACE" title="Historique des actions" />
      <main className="journal-page flex-grow overflow-y-auto px-4 sm:px-6 md:px-8 pt-3 sm:pt-4 pb-10">
        <div className="jr-layout">
          {/* ── Barre latérale : recherche + équipe ── */}
          <aside className="jr-side" aria-label="Filtres">
            <label className="jr-search">
              <Icon name="search" size={14} />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Rechercher…"
                aria-label="Rechercher dans l'historique"
              />
            </label>
            {visibleDomains.length > 0 && (
              <section className="jr-side-section">
                <div className="jr-side-head">
                  <h2>Domaines</h2>
                  {domain && <button type="button" onClick={() => setDomain('')}>Tous</button>}
                </div>
                <ul className="jr-members" role="listbox" aria-label="Filtrer par domaine">
                  <li>
                    <button type="button" role="option" aria-selected={domain === ''} className={domain === '' ? 'active' : ''} onClick={() => setDomain('')}>
                      <span className="jr-member-avatar"><Icon name="grid" size={12} /></span>
                      <span className="jr-member-name">Tous</span>
                    </button>
                  </li>
                  {visibleDomains.map((d) => (
                    <li key={d}>
                      <button type="button" role="option" aria-selected={domain === d} className={domain === d ? 'active' : ''} onClick={() => setDomain(domain === d ? '' : d)}>
                        <span className={`jr-member-avatar jr-domain-avatar ${DOMAIN_META[d].cls}`}>{DOMAIN_META[d].short}</span>
                        <span className="jr-member-name">{DOMAIN_META[d].label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {actorOptions.length > 0 && (
              <section className="jr-side-section">
                <div className="jr-side-head">
                  <h2>Équipe</h2>
                  {actorId && <button type="button" onClick={() => setActorId('')}>Tous</button>}
                </div>
                {actorOptions.length > 8 && (
                  <input
                    type="search"
                    className="jr-side-filter"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Filtrer les membres"
                    aria-label="Filtrer les membres"
                  />
                )}
                <ul className="jr-members" role="listbox" aria-label="Filtrer par personne">
                  <li>
                    <button type="button" role="option" aria-selected={actorId === ''} className={actorId === '' ? 'active' : ''} onClick={() => setActorId('')}>
                      <span className="jr-member-avatar"><Icon name="users" size={12} /></span>
                      <span className="jr-member-name">Toute l'équipe</span>
                    </button>
                  </li>
                  {visibleActors.map((u) => (
                    <li key={u.id}>
                      <button type="button" role="option" aria-selected={actorId === u.id} className={actorId === u.id ? 'active' : ''} onClick={() => setActorId(actorId === u.id ? '' : u.id)}>
                        <span className={`jr-member-avatar jr-member-avatar--${roleFamily(u.role as Role)}`}>{initialsOf(u.name || u.email || '?')}</span>
                        <span className="jr-member-name">{u.name || u.email}</span>
                        <span className="jr-member-role">{ROLE_LABELS[u.role as Role] ?? u.role}</span>
                      </button>
                    </li>
                  ))}
                  {visibleActors.length === 0 && <li className="jr-members-empty">Aucun membre.</li>}
                </ul>
              </section>
            )}

            {scopeHint && <p className="jr-scope">{scopeHint}</p>}
          </aside>

          {/* ── Contenu ── */}
          <div className="jr-main">
            <div className="jr-toolbar">
              <span />
              <select
                value={actorType}
                onChange={(e) => setActorType(e.target.value as ActorType)}
                className="jr-select"
                aria-label="Filtrer par type d'auteur"
              >
                <option value="">Tous les types</option>
                {(Object.keys(ACTOR_TYPES) as Exclude<ActorType, ''>[]).map((k) => (
                  <option key={k} value={k}>{ACTOR_TYPES[k].label}</option>
                ))}
              </select>
              <div className="jr-toolbar-right">
                <DateRangePicker value={period} onChange={setPeriod} align="right" />
              </div>
            </div>

            <div className="jr-meta">
              <span>
                {loadingFirst ? 'Chargement…' : `${results.length}${canLoadMore ? '+' : ''} action${results.length > 1 ? 's' : ''}${results.length !== loaded.length ? ` sur ${loaded.length}` : ''} · ${range.label}`}
              </span>
              {fromCache && (
                <span className="inline-flex items-center gap-1">
                  <Spinner size={10} stroke={3} color="currentColor" /> mise à jour…
                </span>
              )}
              {selectedActor && (
                <span className="jr-pill">
                  {selectedActor.name || selectedActor.email}
                  <button type="button" onClick={() => setActorId('')} aria-label="Retirer le filtre personne">✕</button>
                </span>
              )}
              {(leadId || clientId) && (
                <span className="jr-pill">
                  {leadId ? 'Prospect filtré' : 'Dossier filtré'}
                  <button type="button" onClick={resetFilters} aria-label="Retirer le filtre">✕</button>
                </span>
              )}
              {hasFilters && (
                <button type="button" className="jr-reset" onClick={resetFilters}>Réinitialiser</button>
              )}
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
                <h2 className="jr-day">
                  {dayTitle(rows[0].at)} <span className="font-semibold normal-case tracking-normal">· {rows.length} action{rows.length > 1 ? 's' : ''}</span>
                </h2>
                <ol className="jr-list">
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
                  onClick={loadMore}
                >
                  {loadingMore ? <Spinner size={14} stroke={3} color="currentColor" /> : <Icon name="download" size={14} />}
                  Charger plus
                </button>
              </div>
            )}
          </div>
        )}
          </div>
        </div>
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
      className={`jr-row jr-row--${row.domain} px-3 sm:px-4 py-2.5 transition-colors ${clickable ? 'cursor-pointer outline-none' : ''}`}
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
