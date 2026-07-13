import { useMemo, useState } from 'react'
import { Spinner } from '../Spinner'
import { DateRangePicker } from '../analytics/DateRangePicker'
import { SetterCharts } from './SetterCharts'
import { useSetterStats } from '../../lib/hooks'
import { buildPeriodRange, defaultPeriod, type PeriodState } from '../../lib/period'

// Section « Statistiques & historique » d'un setter, filtrable par jour ou plage
// de dates (calendrier dynamique). Réutilisée par le profil consulté par un
// admin/lead (ProfilSetter) ET par la page « mon profil » d'un setter (MyProfile).
export function SetterStatsSection({ setterId }: { setterId: string | undefined }) {
  // Par défaut : ce mois-ci (vue d'ensemble plus parlante qu'« aujourd'hui »).
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod('this_month'))
  const range = useMemo(() => buildPeriodRange(period), [period])

  const { data: stats, loading } = useSetterStats(setterId, { from: range.from, to: range.to })

  return (
    <div className="space-y-5">
      {/* Sélecteur de période (jour unique ou plage de dates) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="eyebrow text-or-dark">Période</span>
          <span className="font-bold text-text">{range.label}</span>
          {loading && <Spinner size={14} />}
        </div>
        <DateRangePicker value={period} onChange={setPeriod} align="right" />
      </div>

      {/* KPIs minimalistes */}
      <KpiStrip stats={stats} loading={loading} />

      {/* Graphiques + camemberts */}
      {stats ? (
        <SetterCharts stats={stats} />
      ) : (
        <section className="profile-info-card glass-card border border-line-soft bg-white p-10 text-center">
          {loading ? <Spinner /> : <p className="text-sm text-faint">Aucune donnée sur la période.</p>}
        </section>
      )}
    </div>
  )
}

type SetterStats = NonNullable<ReturnType<typeof useSetterStats>['data']>

function KpiStrip({ stats, loading }: { stats: SetterStats | null; loading: boolean }) {
  const items: { value: string; label: string }[] = stats
    ? [
        { value: String(stats.calls), label: 'Appels' },
        { value: String(stats.connected), label: 'Connexions' },
        { value: String(stats.qualified), label: 'Qualifiés' },
        { value: String(stats.rdvPris), label: 'RDV pris' },
        { value: `${stats.qualificationRate}%`, label: 'Taux qualif.' },
        { value: `${stats.connectionRate}%`, label: 'Taux connexion' },
      ]
    : []

  return (
    <section className="profile-info-card glass-card border border-line-soft bg-white p-1.5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {loading && !stats
          ? Array.from({ length: 6 }).map((_, i) => <KpiCell key={i} value="—" label="…" />)
          : items.map((it) => <KpiCell key={it.label} value={it.value} label={it.label} />)}
      </div>
    </section>
  )
}

function KpiCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-4 py-4 text-center sm:text-left">
      <div className="text-2xl font-black leading-none tracking-tight text-text md:text-[28px]">{value}</div>
      <div className="eyebrow mt-1.5 text-[10px] text-muted">{label}</div>
    </div>
  )
}
