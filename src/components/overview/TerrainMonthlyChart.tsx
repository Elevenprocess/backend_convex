import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts'
import type { ClientResponse } from '../../lib/types'
import { computeMonthlyTerrain } from '../../lib/technicienStats'
import { useMemo } from 'react'

// ── palette alignée sur le thème Velora ──────────────────────────────────────
const COLOR_VT = '#1F7857'          // --color-or (vert forêt)
const COLOR_INSTALL = '#B59241'     // --color-cuivre (ambre)
const COLOR_GRID = '#E1EBE3'        // --color-line
const COLOR_TICK = '#5E7264'        // --color-muted
const COLOR_TOOLTIP_BORDER = '#DCE8DE'

function formatMonth(m: string): string {
  const [year, month] = m.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

interface TooltipPayloadEntry {
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
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
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--color-text)', paddingLeft: 10 }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}

// Inline label renderer for Pie — uses optional types matching PieLabelRenderProps
function renderPieLabel(props: {
  cx?: number
  cy?: number
  midAngle?: number
  innerRadius?: number
  outerRadius?: number
  value?: number
}) {
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

// ── composant principal ───────────────────────────────────────────────────────

interface Props {
  clients: ClientResponse[]
}

export function TerrainMonthlyChart({ clients }: Props) {
  const data = useMemo(() => computeMonthlyTerrain(clients), [clients])

  const chartData = useMemo(
    () => data.map((p) => ({ ...p, monthLabel: formatMonth(p.month) })),
    [data],
  )

  const totals = useMemo(() => {
    const vtTotal = data.reduce((s, p) => s + p.vtCount, 0)
    const installTotal = data.reduce((s, p) => s + p.installCount, 0)
    return [
      { name: 'VT réalisées', value: vtTotal, color: COLOR_VT },
      { name: 'Installations posées', value: installTotal, color: COLOR_INSTALL },
    ]
  }, [data])

  const hasPie = totals[0].value + totals[1].value > 0

  if (data.length === 0) {
    return (
      <div className="overview-air-card overview-role-wide" style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--color-or-dark)', marginBottom: 8 }}>
          Activité mensuelle terrain
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-faint)', textAlign: 'center', paddingTop: 24, paddingBottom: 24 }}>
          Aucune VT ou installation réalisée pour l'instant.
        </div>
      </div>
    )
  }

  return (
    <div
      className="overview-air-card"
      style={{
        gridColumn: '1 / -1',
        display: 'grid',
        gridTemplateColumns: hasPie ? '1fr 180px' : '1fr',
        gap: 24,
        alignItems: 'start',
      }}
    >
      {/* ── section gauche : bar chart ────── */}
      <div>
        {/* en-tête */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: 'var(--color-or-dark)',
                marginBottom: 2,
              }}
            >
              Activité mensuelle terrain
            </div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)', letterSpacing: '-0.01em' }}>
              VT réalisées &amp; Installations posées
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <LegendDot color={COLOR_VT} label="VT" />
            <LegendDot color={COLOR_INSTALL} label="Installations" />
          </div>
        </div>

        <ResponsiveContainer width="100%" height={210}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="32%"
            barGap={3}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
            <XAxis
              dataKey="monthLabel"
              tick={{ fontSize: 11, fill: COLOR_TICK }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: COLOR_TICK }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(31,120,87,0.04)', radius: 6 }} />
            <Bar dataKey="vtCount" name="VT réalisées" fill={COLOR_VT} radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Bar dataKey="installCount" name="Installations posées" fill={COLOR_INSTALL} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── section droite : camembert totaux ─ */}
      {hasPie && (
        <div style={{ paddingTop: 8 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: 'var(--color-or-dark)',
              marginBottom: 10,
            }}
          >
            Répartition totale
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={totals}
                cx="50%"
                cy="50%"
                outerRadius={62}
                innerRadius={30}
                dataKey="value"
                labelLine={false}
                label={renderPieLabel}
                strokeWidth={0}
              >
                {totals.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: `1px solid ${COLOR_TOOLTIP_BORDER}`,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* légende du pie */}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {totals.map((t) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--color-muted)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{t.name}</span>
                <strong style={{ color: 'var(--color-text)' }}>{t.value}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
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
