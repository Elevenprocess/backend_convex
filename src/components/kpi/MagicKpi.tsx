import { useId, type PointerEvent } from 'react'
import { Icon, type IconName } from '../Icon'

// === ECOI « chiffres vivants » =============================================
// KPI cards where the value is shown INSTANTLY (no count-up, no reveal delay),
// but the surface is alive: a pointer-tracking light, a barely-there tilt
// toward the cursor, an accent aurora, and a real-data micro-sparkline that
// draws itself — or a radial arc for rate KPIs. Cohesive with the ECOI sage /
// copper / rust glass system; behaves in flat, glass and dark contexts.

export type KpiAccent = 'green' | 'gold' | 'rust' | 'success' | 'info'

const ACCENTS: Record<KpiAccent, { base: string; glow: string }> = {
  green: { base: '#1F7857', glow: '#3E9A6F' },
  gold: { base: '#B59241', glow: '#CFB063' },
  rust: { base: '#A85D2E', glow: '#C77449' },
  success: { base: '#3DA86A', glow: '#5FBE87' },
  info: { base: '#6B8C7C', glow: '#93A89A' },
}

export type DeltaTone = 'success' | 'warn' | 'danger' | 'info'

type MagicKpiProps = {
  label: string
  value: string
  delta?: string
  deltaTone?: DeltaTone
  sub?: string
  accent?: KpiAccent
  icon?: IconName
  /** Real per-period series → draws a sparkline. Ignored when `progress` is set. */
  trend?: number[]
  /** 0..100 → renders a radial arc instead of a sparkline (for rate KPIs). */
  progress?: number
  size?: 'sm' | 'md'
  onClick?: () => void
}

// Pointer → CSS custom props on the card itself. No React state, so the value
// never re-renders: the spotlight + tilt are pure compositor work and the
// number stays painted the instant the card mounts.
function handlePointerMove(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width
  const py = (e.clientY - r.top) / r.height
  el.style.setProperty('--mx', `${(px * 100).toFixed(2)}%`)
  el.style.setProperty('--my', `${(py * 100).toFixed(2)}%`)
  el.style.setProperty('--tilt-x', `${((0.5 - py) * 5).toFixed(2)}deg`)
  el.style.setProperty('--tilt-y', `${((px - 0.5) * 6).toFixed(2)}deg`)
}

function handlePointerLeave(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  el.style.setProperty('--tilt-x', '0deg')
  el.style.setProperty('--tilt-y', '0deg')
}

function Sparkline({ data, accent }: { data: number[]; accent: KpiAccent }) {
  const gid = useId().replace(/:/g, '')
  const pts = data.length >= 2 ? data : [0, 0]
  const max = Math.max(...pts, 1)
  const min = Math.min(...pts, 0)
  const span = max - min || 1
  const W = 100
  const H = 30
  const step = W / (pts.length - 1)
  const coords = pts.map((v, i) => {
    const x = i * step
    const y = H - 3 - ((v - min) / span) * (H - 6)
    return [x, y] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W} ${H} L0 ${H} Z`
  const [lx, ly] = coords[coords.length - 1]
  const stroke = ACCENTS[accent].base
  const glow = ACCENTS[accent].glow
  return (
    <svg className="mkpi-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={glow} stopOpacity="0.16" />
          <stop offset="100%" stopColor={glow} stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <path className="mkpi-spark-area" d={area} fill={`url(#fill-${gid})`} />
      <path className="mkpi-spark-line" d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <circle className="mkpi-spark-dot" cx={lx} cy={ly} r="2.1" fill={stroke} />
    </svg>
  )
}

function Ring({ value, accent }: { value: number; accent: KpiAccent }) {
  const v = Math.max(0, Math.min(100, value))
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <svg className="mkpi-ring" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r={r} fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="3" />
      <circle
        className="mkpi-ring-arc"
        cx="16" cy="16" r={r} fill="none"
        stroke={ACCENTS[accent].base} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v / 100)}
        transform="rotate(-90 16 16)"
        style={{ ['--arc-to' as string]: String(c * (1 - v / 100)), ['--arc-c' as string]: String(c) }}
      />
    </svg>
  )
}

export function MagicKpi({
  label, value, delta, deltaTone = 'success', sub, accent = 'green',
  icon, trend, progress, size = 'md', onClick,
}: MagicKpiProps) {
  const a = ACCENTS[accent]
  const interactive = Boolean(onClick)
  const hasRing = typeof progress === 'number'
  const hasSpark = !hasRing && Array.isArray(trend) && trend.length >= 2
  return (
    <div
      className={`mkpi mkpi-${size}${interactive ? ' mkpi-clickable' : ''}`}
      data-accent={accent}
      style={{ ['--accent' as string]: a.base, ['--accent-glow' as string]: a.glow }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={onClick}
      {...(interactive ? { role: 'button', tabIndex: 0 } : {})}
    >
      <span className="mkpi-aurora" aria-hidden="true" />
      <span className="mkpi-spot" aria-hidden="true" />
      <span className="mkpi-edge" aria-hidden="true" />

      <div className="mkpi-body">
        <div className="mkpi-top">
          <span className="mkpi-label">{label}</span>
          {icon && (
            <span className="mkpi-icon" aria-hidden="true">
              <Icon name={icon} size={size === 'sm' ? 13 : 15} strokeWidth={2.1} />
            </span>
          )}
          {hasRing && <Ring value={progress as number} accent={accent} />}
        </div>

        <div className="mkpi-valrow">
          <span className="mkpi-value">{value}</span>
          {delta && <span className={`mkpi-delta mkpi-delta-${deltaTone}`}>{delta}</span>}
        </div>

        {sub && <div className="mkpi-sub">{sub}</div>}
      </div>

      {hasSpark && <Sparkline data={trend as number[]} accent={accent} />}
    </div>
  )
}
