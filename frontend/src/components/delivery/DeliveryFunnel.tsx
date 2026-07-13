import { Icon } from '../Icon'
import { DELIVERY_PHASES, type DeliveryPipeline } from '../../lib/deliveryOverview'
import { PHASE_COLOR } from '../../lib/deliveryCharts'
import { PHASE_ICON, PHASE_LABEL } from '../../lib/suivi-board'
import { CountUp } from './CountUp'

type Props = {
  pipeline: DeliveryPipeline
  onSelect: (phase: (typeof DELIVERY_PHASES)[number]) => void
}

/**
 * Tunnel de livraison graphique : une barre par phase, largeur ∝ au nombre de
 * dossiers (le tunnel est cumulatif donc naturellement décroissant). Cliquable
 * pour filtrer la page Dossiers. Les barres se déploient à l'apparition (CSS).
 */
export function DeliveryFunnel({ pipeline, onSelect }: Props) {
  const max = Math.max(1, ...DELIVERY_PHASES.map((p) => pipeline.phases[p].count))

  return (
    <div className="dfx-funnel">
      {DELIVERY_PHASES.map((phase, i) => {
        const c = pipeline.phases[phase]
        const pct = Math.round((c.count / max) * 100)
        return (
          <button
            key={phase}
            type="button"
            className="dfx-row"
            style={{ ['--i' as string]: i }}
            onClick={() => onSelect(phase)}
            title={`Filtrer : ${PHASE_LABEL[phase]}`}
          >
            <span className="dfx-row-head">
              <span className="dfx-row-icon" style={{ color: PHASE_COLOR[phase] }}>
                <Icon name={PHASE_ICON[phase]} size={14} />
              </span>
              <span className="dfx-row-label">{PHASE_LABEL[phase]}</span>
            </span>
            <span className="dfx-row-bar">
              <span
                className="dfx-row-fill"
                style={{ ['--w' as string]: `${Math.max(4, pct)}%`, ['--i' as string]: i, background: PHASE_COLOR[phase] }}
              />
            </span>
            <span className="dfx-row-meta">
              <CountUp className="dfx-row-count" value={c.count} />
              {c.late > 0 && <em className="dfx-tag dfx-tag--danger">{c.late} ret.</em>}
              {c.missingDocs > 0 && <em className="dfx-tag dfx-tag--warn">{c.missingDocs} doc</em>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
