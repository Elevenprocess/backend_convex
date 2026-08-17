import { useMemo } from 'react'
import { BarChart, Bar, LabelList, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { ClientResponse } from '../../lib/types'
import { deliveriesByMonth } from '../../lib/deliveryCharts'

const COLOR_BAR = 'var(--color-or)'
const COLOR_TICK = 'var(--color-muted)'
const COLOR_LABEL = 'var(--color-text)'

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
 * Tendance délivrabilité : dossiers signés par mois (barres seules, valeur
 * au-dessus de chaque barre, total de la période en tête — pas de second axe).
 * On trace la signature (seule date fiable de la source) et non les
 * installations/MES, dont la date n'existe pas côté NestJS (suivi par statut).
 */
export function DeliveryTrendChart({ clients, now, monthsBack = 12, title = 'Dossiers signés par mois', subtitle, headStat }: Props) {
  const data = useMemo(() => deliveriesByMonth(clients, monthsBack, now), [clients, monthsBack, now])
  const total = data.reduce((acc, r) => acc + r.signed, 0)
  const hasData = total > 0

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
          <div className="dfx-headstat">
            <small>Total période</small>
            <strong>{total}</strong>
          </div>
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={196}>
          <BarChart data={data} margin={{ top: 18, right: 4, left: 4, bottom: 0 }} barCategoryGap="38%">
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLOR_TICK }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-line-soft)' }} />
            <Bar dataKey="signed" name="Dossiers signés" fill={COLOR_BAR} radius={[4, 4, 4, 4]} maxBarSize={28} animationDuration={500}>
              <LabelList dataKey="signed" position="top" formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '')} style={{ fontSize: 11, fontWeight: 600, fill: COLOR_LABEL }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="dfx-chart-empty">Aucun dossier signé sur la période.</div>
      )}
    </div>
  )
}
