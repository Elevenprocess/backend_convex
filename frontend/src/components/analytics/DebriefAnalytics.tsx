import { useMemo, useState } from 'react'
import { useRdvList } from '../../lib/hooks'
import type { RdvResponse } from '../../lib/types'

type Props = {
  commercialId?: string
  fromDate?: string
  toDate?: string
  title?: string
}

type ParsedDebrief = {
  outcome: 'vente' | 'non_vente' | 'open'
  reasonMain: string
  reasonSub: string
  acceptance: string[]
  objection: string | null
}

// Mêmes palette que Analytics.tsx pour cohérence visuelle.
const PALETTE = ['#145A41', '#3E9A6F', '#1F7857', '#6B7C8C', '#3DA86A', '#3D5DC8', '#7B96EB', '#2D1A8C', '#4C7A8C', '#5E6F7D']
const ACCEPTANCE_COLOR = '#3DA86A'
const NON_SALE_REASON_SEPARATOR = ' — '
const ACCEPTANCE_PREFIX_RE = /^\[Acceptation:\s*([^\]]+)\]\s*\n?/

export function DebriefAnalytics({ commercialId, fromDate, toDate, title = 'Analyse débriefs commerciaux' }: Props) {
  const { data: rdvs, loading } = useRdvList({ commercialId, fromDate, toDate, limit: 500 })
  const parsed = useMemo(() => (rdvs ?? []).map(parseDebrief), [rdvs])

  const nonValidation = useMemo(() => aggregateNonValidation(parsed), [parsed])
  const acceptance = useMemo(() => aggregateAcceptance(parsed), [parsed])
  const objectionsOvercome = useMemo(() => aggregateObjections(parsed, 'vente'), [parsed])
  const objectionsBlocking = useMemo(() => aggregateObjections(parsed, 'non_vente'), [parsed])

  const [expandedReason, setExpandedReason] = useState<string | null>(null)
  const totalDebriefs = parsed.filter((p) => p.outcome !== 'open').length
  const totalNonValidations = parsed.filter((p) => p.outcome === 'non_vente').length
  const totalVentes = parsed.filter((p) => p.outcome === 'vente').length

  if (loading && !rdvs) {
    return (
      <section className="space-y-6">
        <SectionHeader title={title} subtitle="Chargement des débriefs…" />
        <div className="grid grid-cols-12 gap-6">
          <div className="glass-card p-6 col-span-7 h-[340px] animate-pulse bg-white/40" />
          <div className="glass-card p-6 col-span-5 h-[340px] animate-pulse bg-white/40" />
        </div>
      </section>
    )
  }

  if (totalDebriefs === 0) {
    return (
      <section className="space-y-6">
        <SectionHeader title={title} subtitle="Aucun débrief enregistré sur la période — remplissez-en quelques-uns pour voir apparaître les stats." />
        <div className="glass-card p-8 text-center text-sm text-muted">
          Pas de données à afficher pour le moment.
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <SectionHeader
        title={title}
        subtitle={`${totalDebriefs} débrief${totalDebriefs > 1 ? 's' : ''} analysé${totalDebriefs > 1 ? 's' : ''} · ${totalVentes} vente${totalVentes > 1 ? 's' : ''} · ${totalNonValidations} non-vente${totalNonValidations > 1 ? 's' : ''}`}
      />

      <div className="grid grid-cols-12 gap-6">
        <div className="glass-card p-6 col-span-12 xl:col-span-7">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Camembert — Raisons de non-validation</h3>
            <span className="eyebrow">{totalNonValidations} non-ventes</span>
          </div>
          {nonValidation.length === 0 ? (
            <EmptyChart message="Aucune non-vente sur la période." />
          ) : (
            <DonutChart
              segments={nonValidation.map((entry, i) => ({ label: entry.main, value: entry.count, color: PALETTE[i % PALETTE.length] }))}
              total={totalNonValidations}
              centerLabel="non-ventes"
              onSegmentClick={(label) => setExpandedReason((cur) => (cur === label ? null : label))}
              activeLabel={expandedReason}
            />
          )}
        </div>

        <div className="glass-card p-6 col-span-12 xl:col-span-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Facteurs d'acceptation</h3>
            <span className="eyebrow">{totalVentes} ventes</span>
          </div>
          {acceptance.length === 0 ? (
            <EmptyChart message="Aucun facteur d'acceptation enregistré." />
          ) : (
            <BarList entries={acceptance} total={totalVentes} color={ACCEPTANCE_COLOR} />
          )}
        </div>
      </div>

      {expandedReason && (
        <div className="glass-card p-6 border-or/40">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Détail — {expandedReason}</h3>
            <button type="button" onClick={() => setExpandedReason(null)} className="text-xs font-bold text-muted hover:text-text">Fermer</button>
          </div>
          {(() => {
            const entry = nonValidation.find((e) => e.main === expandedReason)
            if (!entry) return null
            return <BarList entries={entry.subs} total={entry.count} color="#3E9A6F" />
          })()}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="glass-card p-6 col-span-12 xl:col-span-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Objections surmontées (ventes)</h3>
            <span className="eyebrow">arguments gagnants</span>
          </div>
          {objectionsOvercome.length === 0 ? (
            <EmptyChart message="Pas encore d'objection surmontée enregistrée." />
          ) : (
            <BarList entries={objectionsOvercome} total={objectionsOvercome.reduce((s, e) => s + e.count, 0)} color="#1F7857" />
          )}
        </div>
        <div className="glass-card p-6 col-span-12 xl:col-span-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold">Objections bloquantes (non-ventes)</h3>
            <span className="eyebrow">à travailler</span>
          </div>
          {objectionsBlocking.length === 0 ? (
            <EmptyChart message="Pas encore d'objection bloquante enregistrée." />
          ) : (
            <BarList entries={objectionsBlocking} total={objectionsBlocking.reduce((s, e) => s + e.count, 0)} color="#145A41" />
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-2xl font-extrabold">{title}</h2>
      <p className="text-sm text-muted mt-1">{subtitle}</p>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return <div className="flex items-center justify-center h-[180px] text-sm text-faint">{message}</div>
}

function DonutChart({
  segments,
  total,
  centerLabel,
  onSegmentClick,
  activeLabel,
}: {
  segments: { label: string; value: number; color: string }[]
  total: number
  centerLabel: string
  onSegmentClick?: (label: string) => void
  activeLabel?: string | null
}) {
  const radius = 90
  const innerRadius = 56
  return (
    <div className="grid grid-cols-[220px_1fr] gap-6 items-center">
      <div className="relative w-[220px] h-[220px]">
        <svg width="220" height="220" viewBox="-110 -110 220 220">
          {segments.length === 1 ? (
            <FullRing radius={radius} innerRadius={innerRadius} color={segments[0].color} />
          ) : (
            (() => {
              let cumulative = 0
              return segments.map((s) => {
                const angle = (s.value / total) * 2 * Math.PI
                const path = describeArc(0, 0, radius, innerRadius, cumulative, cumulative + angle)
                cumulative += angle
                const isActive = activeLabel === s.label
                return (
                  <path
                    key={s.label}
                    d={path}
                    fill={s.color}
                    opacity={activeLabel && !isActive ? 0.4 : 1}
                    stroke="white"
                    strokeWidth={2}
                    className={onSegmentClick ? 'cursor-pointer transition-opacity' : ''}
                    onClick={() => onSegmentClick?.(s.label)}
                  />
                )
              })
            })()
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="font-extrabold text-2xl leading-none">{total}</div>
            <div className="eyebrow mt-1">{centerLabel}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {segments.map((s) => {
          const isActive = activeLabel === s.label
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => onSegmentClick?.(s.label)}
              className={`w-full text-left rounded-xl px-3 py-2 transition ${isActive ? 'bg-or-tint/60' : 'hover:bg-cream/60'}`}
            >
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-2">
                  <i className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="font-semibold">{s.label}</span>
                </span>
                <span className="font-bold">{s.value} · {Math.round((s.value / total) * 100)}%</span>
              </div>
              {onSegmentClick && <div className="text-[10px] text-faint mt-0.5">Clique pour voir le détail des sous-cas</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FullRing({ radius, innerRadius, color }: { radius: number; innerRadius: number; color: string }) {
  return (
    <>
      <circle cx={0} cy={0} r={radius} fill={color} />
      <circle cx={0} cy={0} r={innerRadius} fill="white" />
    </>
  )
}

function BarList({ entries, total, color }: { entries: { label: string; count: number }[]; total: number; color: string }) {
  if (entries.length === 0 || total === 0) return <EmptyChart message="Aucune donnée à comparer." />
  const max = Math.max(...entries.map((e) => e.count))
  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div key={e.label}>
          <div className="flex justify-between items-center text-sm mb-1">
            <span className="font-semibold">{e.label}</span>
            <span className="font-bold">{e.count} · {Math.round((e.count / total) * 100)}%</span>
          </div>
          <div className="h-2 bg-line-soft rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(e.count / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Parsing & aggregation ──────────────────────────────────────────

export function parseDebrief(rdv: RdvResponse): ParsedDebrief {
  const outcome: ParsedDebrief['outcome'] = rdv.result === 'signe' ? 'vente' : rdv.result == null ? 'open' : 'non_vente'
  const { main, sub } = splitReason(rdv.nonSaleReason)
  const acceptance = parseAcceptance(rdv.notes)
  return {
    outcome,
    reasonMain: main,
    reasonSub: sub,
    acceptance,
    objection: rdv.objections?.trim() || null,
  }
}

export function splitReason(raw: string | null): { main: string; sub: string } {
  if (!raw) return { main: '', sub: '' }
  const idx = raw.indexOf(NON_SALE_REASON_SEPARATOR)
  if (idx === -1) return { main: raw.trim(), sub: '' }
  return { main: raw.slice(0, idx).trim(), sub: raw.slice(idx + NON_SALE_REASON_SEPARATOR.length).trim() }
}

export function parseAcceptance(notes: string | null): string[] {
  if (!notes) return []
  const match = notes.match(ACCEPTANCE_PREFIX_RE)
  if (!match) return []
  return match[1].split('|').map((s) => s.trim()).filter(Boolean)
}

function aggregateNonValidation(parsed: ParsedDebrief[]) {
  const map = new Map<string, { main: string; count: number; subsMap: Map<string, number> }>()
  for (const p of parsed) {
    if (p.outcome !== 'non_vente' || !p.reasonMain) continue
    const entry = map.get(p.reasonMain) ?? { main: p.reasonMain, count: 0, subsMap: new Map() }
    entry.count += 1
    const subKey = p.reasonSub || '(non précisé)'
    entry.subsMap.set(subKey, (entry.subsMap.get(subKey) ?? 0) + 1)
    map.set(p.reasonMain, entry)
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .map((e) => ({
      main: e.main,
      count: e.count,
      subs: Array.from(e.subsMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
    }))
}

function aggregateAcceptance(parsed: ParsedDebrief[]) {
  const map = new Map<string, number>()
  for (const p of parsed) {
    if (p.outcome !== 'vente') continue
    for (const factor of p.acceptance) {
      map.set(factor, (map.get(factor) ?? 0) + 1)
    }
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

function aggregateObjections(parsed: ParsedDebrief[], outcome: 'vente' | 'non_vente') {
  const map = new Map<string, number>()
  for (const p of parsed) {
    if (p.outcome !== outcome || !p.objection) continue
    map.set(p.objection, (map.get(p.objection) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

// ─── SVG arc geometry ───────────────────────────────────────────────

function describeArc(cx: number, cy: number, outer: number, inner: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, outer, endAngle)
  const end = polarToCartesian(cx, cy, outer, startAngle)
  const innerStart = polarToCartesian(cx, cy, inner, endAngle)
  const innerEnd = polarToCartesian(cx, cy, inner, startAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return [
    'M', start.x, start.y,
    'A', outer, outer, 0, largeArc, 0, end.x, end.y,
    'L', innerEnd.x, innerEnd.y,
    'A', inner, inner, 0, largeArc, 1, innerStart.x, innerStart.y,
    'Z',
  ].join(' ')
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  // angle 0 = top, clockwise
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  }
}
