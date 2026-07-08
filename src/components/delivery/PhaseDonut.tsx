import { useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import type { ClientResponse, WorkflowPhase } from '../../lib/types'
import { currentPhaseDistribution } from '../../lib/deliveryCharts'
import { CountUp } from './CountUp'

type Props = {
  clients: ClientResponse[]
  onSelect?: (phase: WorkflowPhase) => void
}

/** Donut « où en sont les dossiers » : répartition par phase courante (active). */
export function PhaseDonut({ clients, onSelect }: Props) {
  const slices = useMemo(() => currentPhaseDistribution(clients).filter((s) => s.count > 0), [clients])
  const total = useMemo(() => slices.reduce((n, s) => n + s.count, 0), [slices])

  return (
    <div className="dfx-donut-card">
      <div className="dfx-chart-head">
        <div>
          <span className="dfx-eyebrow">Répartition</span>
          <h3 className="dfx-chart-title">Dossiers par phase</h3>
        </div>
      </div>
      {total === 0 ? (
        <div className="dfx-chart-empty">Aucun dossier actif.</div>
      ) : (
        <div className="dfx-donut-body">
          <div className="dfx-donut-ring">
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={46}
                  outerRadius={66}
                  paddingAngle={2}
                  strokeWidth={0}
                  startAngle={90}
                  endAngle={-270}
                  animationDuration={800}
                  onClick={(_, index: number) => {
                    const s = slices[index]
                    if (s) onSelect?.(s.phase)
                  }}
                >
                  {slices.map((s) => (
                    <Cell key={s.phase} fill={s.color} cursor={onSelect ? 'pointer' : 'default'} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="dfx-donut-center">
              <CountUp className="dfx-donut-total" value={total} />
              <small>actifs</small>
            </div>
          </div>
          <div className="dfx-donut-legend">
            {slices.map((s) => (
              <span
                key={s.phase}
                className={`dfx-legend-row ${onSelect ? 'is-clickable' : ''}`}
                onClick={() => onSelect?.(s.phase)}
                role={onSelect ? 'button' : undefined}
                aria-label={onSelect ? `Filtrer phase ${s.label}` : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onSelect(s.phase)
                  }
                }}
              >
                <i style={{ background: s.color }} />
                <span className="dfx-legend-label">{s.label}</span>
                <strong>{s.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
