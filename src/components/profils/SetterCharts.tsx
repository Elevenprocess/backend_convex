import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalyticsSetterSummary } from '../../lib/types'

// ── palette alignée sur le thème Velora (cf. TerrainMonthlyChart) ─────────────
const COLOR_OR = '#1F7857'
const COLOR_CUIVRE = '#B59241'
const COLOR_GRID = '#E1EBE3'
const COLOR_TICK = '#5E7264'
const COLOR_TOOLTIP_BORDER = '#DCE8DE'
// Palette de repli pour le camembert « Issue des leads ».
const PIPELINE_COLORS = ['#1F7857', '#B59241', '#6B7C8C', '#C2703D', '#B7410E']

interface TooltipPayloadEntry {
  name: string
  value: number
  color: string
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--color-card)',
        border: `1px solid ${COLOR_TOOLTIP_BORDER}`,
        borderRadius: 10,
        padding: '9px 13px',
        fontSize: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--color-text)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--color-muted)' }}>{entry.name}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--color-text)', paddingLeft: 10 }}>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

function renderPieLabel(props: { cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; value?: number }) {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, value = 0 } = props
  if (!value) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {value}
    </text>
  )
}

type Segment = { label: string; value: number; color: string }

// ── briques de présentation ───────────────────────────────────────────────────

function CardHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="eyebrow text-or-dark">{eyebrow}</p>
      <h3 className="text-base font-black">{title}</h3>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-10 text-center text-sm text-faint">{message}</p>
}

function PieLegend({ segments, total }: { segments: Segment[]; total: number }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {segments.map((s) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--color-muted)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{s.label}</span>
          <strong style={{ color: 'var(--color-text)' }}>
            {s.value}
            {total > 0 && <span style={{ color: 'var(--color-faint)', fontWeight: 600 }}> · {Math.round((s.value / total) * 100)}%</span>}
          </strong>
        </div>
      ))}
    </div>
  )
}

function DonutCard({ eyebrow, title, segments, emptyMessage }: { eyebrow: string; title: string; segments: Segment[]; emptyMessage: string }) {
  const data = useMemo(() => segments.filter((s) => s.value > 0), [segments])
  const total = useMemo(() => data.reduce((sum, s) => sum + s.value, 0), [data])
  return (
    <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
      <CardHeader eyebrow={eyebrow} title={title} />
      {total === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" outerRadius={70} innerRadius={42} dataKey="value" labelLine={false} label={renderPieLabel} strokeWidth={0}>
                {data.map((s) => (
                  <Cell key={s.label} fill={s.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${COLOR_TOOLTIP_BORDER}`, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <PieLegend segments={data} total={total} />
        </>
      )}
    </section>
  )
}

// ── composant principal ─────────────────────────────────────────────────────

export function SetterCharts({ stats }: { stats: AnalyticsSetterSummary }) {
  // Évolution dans le temps : appels (aire) + qualifiés + RDV (courbes).
  const evolution = useMemo(
    () => stats.dailyEvolution.map((p) => ({ label: p.label, calls: p.calls, qualified: p.qualified, rdv: p.rdv })),
    [stats.dailyEvolution],
  )
  const hasEvolution = evolution.some((p) => p.calls + p.qualified + p.rdv > 0)

  // Volume d'appels par heure : on agrège toutes les journées de la plage par
  // heure (le backend renvoie une ligne par jour×heure, 8h→21h).
  const hourly = useMemo(() => {
    const byHour = new Map<number, number>()
    for (const point of stats.hourlyCalls ?? []) {
      byHour.set(point.hour, (byHour.get(point.hour) ?? 0) + point.calls)
    }
    return Array.from(byHour.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, calls]) => ({ label: `${hour}h`, calls }))
  }, [stats.hourlyCalls])
  const hasHourly = hourly.some((p) => p.calls > 0)

  // Issue des leads : partition lisible des leads traités sur la période.
  const pipelineSegments = useMemo<Segment[]>(() => {
    const qualifiedOnly = Math.max(0, stats.qualified - stats.rdvPris)
    const noAnswer = Math.max(0, stats.newLeads - stats.answered)
    return [
      { label: 'RDV pris', value: stats.rdvPris, color: PIPELINE_COLORS[0] },
      { label: 'Qualifiés (hors RDV)', value: qualifiedOnly, color: PIPELINE_COLORS[1] },
      { label: 'En relance', value: stats.relance, color: PIPELINE_COLORS[2] },
      { label: 'Non qualifiés', value: stats.notQualified, color: PIPELINE_COLORS[3] },
      { label: 'Sans réponse', value: noAnswer, color: PIPELINE_COLORS[4] },
    ]
  }, [stats])

  const resultSegments = useMemo<Segment[]>(
    () => stats.resultSegments.map((s) => ({ label: s.label, value: s.value, color: s.color })),
    [stats.resultSegments],
  )

  return (
    <div className="space-y-5">
      {/* Évolution dans le temps — pleine largeur */}
      <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <CardHeader eyebrow="Historique" title="Évolution de l'activité" />
          <div className="flex gap-3 pt-1">
            <LegendDot color={COLOR_OR} label="Appels" />
            <LegendDot color={COLOR_CUIVRE} label="Qualifiés" />
            <LegendDot color="#6B7C8C" label="RDV" />
          </div>
        </div>
        {!hasEvolution ? (
          <EmptyState message="Aucune activité sur la période sélectionnée." />
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={evolution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="setterCallsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_OR} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLOR_OR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} width={28} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: COLOR_GRID }} />
              <Area type="monotone" dataKey="calls" name="Appels" stroke={COLOR_OR} strokeWidth={2.5} fill="url(#setterCallsGradient)" dot={false} />
              <Line type="monotone" dataKey="qualified" name="Qualifiés" stroke={COLOR_CUIVRE} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="rdv" name="RDV" stroke="#6B7C8C" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Camemberts — résultats d'appels + issue des leads */}
      <div className="grid gap-5 md:grid-cols-2">
        <DonutCard
          eyebrow="Issue des appels"
          title="Résultats d'appels"
          segments={resultSegments}
          emptyMessage="Aucun appel sur la période."
        />
        <DonutCard
          eyebrow="Pipeline"
          title="Issue des leads"
          segments={pipelineSegments}
          emptyMessage="Aucun lead traité sur la période."
        />
      </div>

      {/* Volume d'appels par heure */}
      <section className="profile-info-card glass-card border border-line-soft bg-white p-5 md:p-6">
        <CardHeader eyebrow="Rythme" title="Volume d'appels par heure" />
        {!hasHourly ? (
          <EmptyState message="Aucun appel enregistré sur la période." />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} width={28} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(31,120,87,0.04)', radius: 6 }} />
              <Bar dataKey="calls" name="Appels" fill={COLOR_OR} radius={[4, 4, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-muted)' }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
      {label}
    </div>
  )
}
