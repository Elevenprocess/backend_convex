import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MonthPoint } from '../../lib/financesCharts'

interface Props {
  data: MonthPoint[]
  subtitle?: string
}

function formatMonth(m: string): string {
  const [year, month] = m.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

const euro = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`
const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}k€` : `${v}€`)

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
          <strong>{euro(e.value)}</strong>
        </div>
      ))}
    </div>
  )
}

/**
 * Courbe d'encaissement : cumul encaissé (vert) vs reste à encaisser (cuivre).
 * Sans grille ni axe Y lourd : deux aires douces, repères mensuels.
 */
export function FinancesCharts({ data, subtitle }: Props) {
  const chartData = data.map((p) => ({ ...p, monthLabel: formatMonth(p.month) }))
  const last = data[data.length - 1]

  return (
    <div className="fin-card fin-chart">
      <div className="fin-card-head">
        <div>
          <span className="fin-eyebrow">Encaissements</span>
          <h3>Cumul encaissé vs reste à encaisser</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {last && (
          <div className="fin-legend">
            <span><i style={{ background: 'var(--color-or)' }} />Encaissé <b>{compact(last.cumulEncaisse)}</b></span>
            <span><i style={{ background: 'var(--color-cuivre)' }} />Reste <b>{compact(last.resteTotal)}</b></span>
          </div>
        )}
      </div>
      {data.length === 0 ? (
        <div className="fin-chart-empty">Aucun encaissement sur la période.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="finGradEnc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-or)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--color-or)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="finGradReste" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-cuivre)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-cuivre)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--color-faint)' }} tickLine={false} axisLine={false} width={58} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-line)' }} />
            <Area type="monotone" dataKey="cumulEncaisse" name="Encaissement cumulé" stroke="var(--color-or)" strokeWidth={2} fill="url(#finGradEnc)" dot={false} activeDot={{ r: 4 }} animationDuration={500} />
            <Area type="monotone" dataKey="resteTotal" name="Reste à encaisser" stroke="var(--color-cuivre)" strokeWidth={2} fill="url(#finGradReste)" dot={false} activeDot={{ r: 4 }} animationDuration={500} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
