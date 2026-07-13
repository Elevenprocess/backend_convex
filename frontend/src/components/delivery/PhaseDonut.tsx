import { useMemo } from 'react'
import type { ClientResponse, WorkflowPhase } from '../../lib/types'
import { currentPhaseDistribution } from '../../lib/deliveryCharts'
import { CountUp } from './CountUp'

type Props = {
  clients: ClientResponse[]
  onSelect?: (phase: WorkflowPhase) => void
}

/**
 * « Où en sont les dossiers » : répartition des dossiers actifs par phase
 * courante. Les phases sont des ÉTAPES ordonnées → barres horizontales dans
 * l'ordre du pipeline (un donut cachait l'ordre et se lisait mal), étiquettes
 * et valeurs directes, phases vides conservées (la forme du tunnel reste
 * honnête). Chaque ligne filtre la liste en dessous.
 */
export function PhaseDonut({ clients, onSelect }: Props) {
  const slices = useMemo(() => currentPhaseDistribution(clients), [clients])
  const total = useMemo(() => slices.reduce((n, s) => n + s.count, 0), [slices])
  const max = useMemo(() => Math.max(...slices.map((s) => s.count), 1), [slices])

  return (
    <div className="dfx-donut-card">
      <div className="dfx-chart-head">
        <div>
          <span className="dfx-eyebrow">Répartition</span>
          <h3 className="dfx-chart-title">Dossiers par phase</h3>
        </div>
        <div className="dfx-headstat">
          <small>actifs</small>
          <strong><CountUp value={total} /></strong>
        </div>
      </div>
      {total === 0 ? (
        <div className="dfx-chart-empty">Aucun dossier actif.</div>
      ) : (
        <div className="dfx-phasebars" role="list">
          {slices.map((s) => {
            const pct = Math.round((s.count / total) * 100)
            const Row = onSelect ? 'button' : 'div'
            return (
              <Row
                key={s.phase}
                {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(s.phase) } : {})}
                className={`dfx-phasebar-row ${s.count === 0 ? 'is-empty' : ''} ${onSelect ? 'is-clickable' : ''}`}
                role="listitem"
                title={`${s.label} : ${s.count} dossier${s.count > 1 ? 's' : ''} · ${pct}% des actifs`}
                aria-label={onSelect ? `Filtrer phase ${s.label} (${s.count})` : undefined}
              >
                <span className="dfx-phasebar-label">
                  <i style={{ background: s.color }} aria-hidden />
                  {s.label}
                </span>
                <span className="dfx-phasebar-track" aria-hidden>
                  <span
                    className="dfx-phasebar-fill"
                    style={{ width: `${Math.max(s.count > 0 ? 3 : 0, (s.count / max) * 100)}%`, background: s.color }}
                  />
                </span>
                <span className="dfx-phasebar-value">
                  <strong>{s.count}</strong>
                  <small>{pct}%</small>
                </span>
              </Row>
            )
          })}
        </div>
      )}
    </div>
  )
}
