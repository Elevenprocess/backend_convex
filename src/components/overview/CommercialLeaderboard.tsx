import type { AnalyticsCommercialPerf, CommercialObjectiveResponse } from '../../lib/types'

export type LeaderboardRow = {
  perf: AnalyticsCommercialPerf
  objective: CommercialObjectiveResponse | null
}

const eur0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
function fmtK(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} k€`
  return `${eur0.format(Math.round(v))} €`
}
function pct(actual: number, target: number | null | undefined): number | null {
  if (!target || target <= 0) return null
  return Math.round((actual / target) * 100)
}
function rankClass(rank: number): string {
  return rank === 1 ? 'is-gold' : rank === 2 ? 'is-silver' : rank === 3 ? 'is-bronze' : ''
}

/**
 * Classement de l'équipe closing : chaque commercial avec son CA (barre relative
 * au leader), son closing, ses ventes et l'atteinte de son objectif CA du mois.
 */
export function CommercialLeaderboard({ rows, onEditObjectives }: { rows: LeaderboardRow[]; onEditObjectives?: () => void }) {
  const sorted = [...rows].sort((a, b) => b.perf.ca - a.perf.ca || b.perf.signed - a.perf.signed)
  const maxCa = Math.max(1, ...sorted.map((r) => r.perf.ca))

  return (
    <div className="lead-board">
      <header className="lead-board-head">
        <div>
          <span className="shot-eyebrow">Pilotage</span>
          <h3>Classement de l'équipe</h3>
        </div>
        {onEditObjectives && (
          <button type="button" className="lead-board-objbtn" onClick={onEditObjectives}>
            Définir les objectifs
          </button>
        )}
      </header>

      {sorted.length === 0 ? (
        <p className="lead-board-empty">Aucune donnée commerciale sur la période.</p>
      ) : (
        <ol className="lead-board-list">
          {sorted.map((row, i) => {
            const rank = i + 1
            const { perf, objective } = row
            const caPct = pct(perf.ca, objective?.caTarget)
            const ventesPct = pct(perf.signed, objective?.ventesTarget)
            const barCa = Math.round((perf.ca / maxCa) * 100)
            return (
              <li key={perf.id} className="lead-board-row">
                <span className={`lead-board-rank ${rankClass(rank)}`}>{rank}</span>
                <span className="lead-board-avatar">{perf.initials}</span>

                <div className="lead-board-id">
                  <strong>{perf.name}</strong>
                  <small>{perf.signed} vente{perf.signed > 1 ? 's' : ''} · {perf.honored} RDV honorés</small>
                </div>

                <div className="lead-board-ca">
                  <div className="lead-board-ca-top">
                    <span className="lead-board-ca-val">{fmtK(perf.ca)}</span>
                    {caPct != null && (
                      <span className={`lead-board-objpill ${caPct >= 100 ? 'is-done' : caPct >= 60 ? 'is-mid' : 'is-low'}`}>
                        {caPct}% obj.
                      </span>
                    )}
                  </div>
                  <div className="lead-board-bar">
                    <div className="lead-board-bar-fill" style={{ width: `${barCa}%` }} />
                    {objective?.caTarget ? (
                      <div className="lead-board-bar-target" style={{ left: `${Math.min(100, Math.round((objective.caTarget / maxCa) * 100))}%` }} title={`Objectif ${fmtK(objective.caTarget)}`} />
                    ) : null}
                  </div>
                </div>

                <div className="lead-board-metric">
                  <span className="lead-board-metric-val">{perf.closing}%</span>
                  <small>closing</small>
                </div>
                <div className="lead-board-metric">
                  <span className="lead-board-metric-val">{ventesPct != null ? `${ventesPct}%` : '—'}</span>
                  <small>obj. ventes</small>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
