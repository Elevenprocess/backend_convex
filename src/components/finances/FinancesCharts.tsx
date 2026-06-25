import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { MonthPoint } from '../../lib/financesCharts'

interface Props {
  data: MonthPoint[]
}

function formatMonth(m: string): string {
  // YYYY-MM → Mmm YYYY (ex: Jan 2026)
  const [year, month] = m.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

function formatEuro(v: number): string {
  return `${v.toLocaleString('fr-FR')} €`
}

/**
 * Graphique recharts : cumul encaissé (area verte) vs reste à encaisser (area ambre).
 * Les deux séries visualisent l'évolution du gap entre encaissé et restant dû.
 */
export function FinancesCharts({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-6 text-center text-sm text-faint">
        Aucune donnée d'encaissement à afficher pour la période sélectionnée.
      </div>
    )
  }

  const chartData = data.map((p) => ({
    ...p,
    monthLabel: formatMonth(p.month),
  }))

  return (
    <div className="glass-card p-4 mb-5">
      <div className="eyebrow text-or-dark mb-3">Encaissé vs Reste à encaisser</div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="gradEncaisse" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#b69a5c" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#b69a5c" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradReste" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#c0522a" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#c0522a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8e0d2" />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 11, fill: '#8a7e6e' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
            tick={{ fontSize: 11, fill: '#8a7e6e' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value) => [typeof value === 'number' ? formatEuro(value) : String(value ?? '')]}
            labelStyle={{ fontWeight: 700, fontSize: 12 }}
            contentStyle={{ borderRadius: 8, border: '1px solid #e8e0d2', fontSize: 12 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
          />
          <Area
            type="monotone"
            dataKey="cumulEncaisse"
            name="Cumul encaissé"
            stroke="#b69a5c"
            strokeWidth={2}
            fill="url(#gradEncaisse)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Area
            type="monotone"
            dataKey="resteTotal"
            name="Reste à encaisser"
            stroke="#c0522a"
            strokeWidth={2}
            fill="url(#gradReste)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
