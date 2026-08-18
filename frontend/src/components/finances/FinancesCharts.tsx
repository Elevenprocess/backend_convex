import { ComposedChart, Bar, Line, LabelList, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
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
const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: v >= 10000 ? 0 : 1 })}k€` : `${Math.round(v)}€`)

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
 * Encaissements par mois (barres, montant au-dessus) + courbe du cumul sur la
 * période. Le « reste à encaisser » n'est plus tracé ici : à l'échelle du
 * chiffre signé, il écrasait tout en une ligne plate — il vit dans les KPI et
 * la carte Répartition.
 */
export function FinancesCharts({ data, subtitle }: Props) {
  const chartData = data.map((p) => ({ ...p, monthLabel: formatMonth(p.month) }))
  const last = data[data.length - 1]
  const first = data[0]
  const periodTotal = last && first ? last.cumulEncaisse - (first.cumulEncaisse - first.encaisse) : 0
  const hasData = data.some((p) => p.encaisse > 0)

  return (
    <div className="fin-card fin-chart">
      <div className="fin-card-head">
        <div>
          <span className="fin-eyebrow">Encaissements</span>
          <h3>Encaissé par mois</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {last && (
          <div className="fin-legend">
            <span><i style={{ background: 'var(--color-or)' }} />Par mois · total <b>{compact(periodTotal)}</b></span>
            <span><i style={{ background: 'var(--color-cuivre)' }} />Cumul <b>{compact(last.cumulEncaisse)}</b></span>
          </div>
        )}
      </div>
      {!hasData ? (
        <div className="fin-chart-empty">Aucun encaissement sur la période.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="38%">
            <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--color-faint)' }} tickLine={false} axisLine={false} width={58} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-line-soft)' }} />
            <Bar dataKey="encaisse" name="Encaissé dans le mois" fill="var(--color-or)" radius={[4, 4, 4, 4]} maxBarSize={30} animationDuration={500}>
              <LabelList dataKey="encaisse" position="top" formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? compact(v) : '')} style={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text)' }} />
            </Bar>
            <Line type="monotone" dataKey="cumulEncaisse" name="Cumul encaissé" stroke="var(--color-cuivre)" strokeWidth={2} dot={{ r: 3, fill: 'var(--color-cuivre)', strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={500} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
