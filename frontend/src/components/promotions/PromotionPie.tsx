// Camembert d'une promo (carte admin) : où en sont ses leads, en 4 parts qui
// ne se chevauchent pas — pas encore joints → joints → qualifiés → signés.
// Étapes ordonnées : une seule teinte, du plus clair au plus foncé.
import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import type { StatBlock } from '../../lib/promotionsApi'

export type PieSlice = { key: string; label: string; value: number; color: string }

export function promotionPieSlices(blocks: StatBlock[]): PieSlice[] {
  const sum = (k: keyof StatBlock) => blocks.reduce((n, b) => n + b[k], 0)
  const leads = sum('leads')
  const joints = sum('joints')
  const qualifies = sum('qualifies')
  const signes = sum('signes')
  return [
    { key: 'non_joints', label: 'Pas encore joints', value: Math.max(0, leads - Math.max(joints, qualifies)), color: '#D3E6DA' },
    { key: 'joints', label: 'Joints, pas qualifiés', value: Math.max(0, joints - qualifies), color: '#8DC3A3' },
    { key: 'qualifies', label: 'Qualifiés', value: Math.max(0, qualifies - signes), color: '#3E9A6F' },
    { key: 'signes', label: 'Signés', value: signes, color: '#145A41' },
  ]
}

export function PromotionPie({ blocks }: { blocks: StatBlock[] }) {
  const slices = promotionPieSlices(blocks)
  const total = slices.reduce((n, s) => n + s.value, 0)
  if (total === 0) return null
  const pct = (v: number) => `${Math.round((v / total) * 100)} %`
  return (
    <figure className="flex items-center gap-3" aria-label="Répartition des leads de la promotion">
      <div className="relative h-[104px] w-[104px] flex-shrink-0">
        <PieChart width={104} height={104}>
          <Pie data={slices.filter((s) => s.value > 0)} dataKey="value" nameKey="label" innerRadius={30} outerRadius={50}
            stroke="var(--color-surface, #fff)" strokeWidth={2} isAnimationActive={false}>
            {slices.filter((s) => s.value > 0).map((s) => <Cell key={s.key} fill={s.color} />)}
          </Pie>
          <Tooltip
            formatter={(v, name) => [`${Number(v)} leads · ${pct(Number(v))}`, String(name)]}
            contentStyle={{ borderRadius: 10, fontSize: 11, padding: '4px 8px' }}
          />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-base font-black text-text">{total}</span>
          <span className="text-[9px] font-semibold text-muted">leads</span>
        </div>
      </div>
      <ul className="space-y-0.5 text-[11px] text-text">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
            <span className="text-muted">{s.label}</span>
            <span className="font-bold">{s.value}</span>
            <span className="text-faint">({pct(s.value)})</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
