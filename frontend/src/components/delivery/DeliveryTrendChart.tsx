import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { ClientResponse } from '../../lib/types'
import { deliveriesByMonth } from '../../lib/deliveryCharts'

const COLOR_INSTALL = '#B59241'
const COLOR_MES = '#1F7857'
const COLOR_GRID = 'var(--color-line)'
const COLOR_TICK = 'var(--color-muted)'

interface TooltipEntry { name: string; value: number; color: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="dfx-tooltip">
      <div className="dfx-tooltip-title">{label}</div>
      {payload.map((e) => (
        <div key={e.name} className="dfx-tooltip-row">
          <span className="dfx-tooltip-dot" style={{ background: e.color }} />
          <span className="dfx-tooltip-name">{e.name}</span>
          <strong>{e.value}</strong>
        </div>
      ))}
    </div>
  )
}

type Props = {
  clients: ClientResponse[]
  now: Date
  monthsBack?: number
  title?: string
  subtitle?: string
  headStat?: { label: string; value: string }
}

/**
 * Tendance délivrabilité : dossiers signés par mois (barres) + cumul (ligne).
 * On trace la signature (seule date fiable de la source) et non les
 * installations/MES, dont la date n'existe pas côté NestJS (suivi par statut).
 */
export function DeliveryTrendChart({ clients, now, monthsBack = 12, title = 'Dossiers signés par mois', subtitle, headStat }: Props) {
  const data = useMemo(() => {
    const rows = deliveriesByMonth(clients, monthsBack, now)
    let cumul = 0
    return rows.map((r) => ({ ...r, cumul: (cumul += r.signed) }))
  }, [clients, monthsBack, now])
  const total = data.length ? data[data.length - 1].cumul : 0
  const hasData = data.some((d) => d.signed > 0)

  return (
    <div className="dfx-chart-card">
      <div className="dfx-chart-head">
        <div>
          <span className="dfx-eyebrow">Tendance</span>
          <h3 className="dfx-chart-title">{title}</h3>
          {subtitle && <p className="dfx-chart-sub">{subtitle}</p>}
        </div>
        <div className="dfx-chart-head-right">
          {headStat && (
            <div className="dfx-headstat">
              <small>{headStat.label}</small>
              <strong>{headStat.value}</strong>
            </div>
          )}
          <div className="dfx-legend">
            <span className="dfx-legend-item"><i style={{ background: COLOR_INSTALL }} />Signés / mois</span>
            <span className="dfx-legend-item"><i style={{ background: COLOR_MES }} />Cumul ({total})</span>
          </div>
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={196}>
          <ComposedChart data={data} margin={{ top: 6, right: -18, left: -18, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} width={34} />
            <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} width={34} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(31,120,87,0.05)' }} />
            <Bar yAxisId="left" dataKey="signed" name="Dossiers signés" fill={COLOR_INSTALL} radius={[5, 5, 0, 0]} maxBarSize={34} animationDuration={700} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumul"
              name="Cumul signés"
              stroke={COLOR_MES}
              strokeWidth={3}
              dot={{ r: 3, fill: COLOR_MES, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              animationDuration={900}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="dfx-chart-empty">Aucun dossier signé sur la période.</div>
      )}
    </div>
  )
}
