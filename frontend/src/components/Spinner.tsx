import { Hatch } from 'ldrs/react'
import 'ldrs/react/Hatch.css'

type SpinnerProps = {
  size?: number | string
  stroke?: number | string
  speed?: number | string
  color?: string
  label?: string
  className?: string
}

export function Spinner({
  size = 28,
  stroke = 4,
  speed = 3.5,
  color = 'currentColor',
  label,
  className,
}: SpinnerProps) {
  return (
    <span className={`inline-flex items-center justify-center gap-2 align-middle ${className ?? ''}`}>
      <Hatch
        size={String(size)}
        stroke={String(stroke)}
        speed={String(speed)}
        color={color}
      />
      {label && <span>{label}</span>}
    </span>
  )
}

export function LoadingBlock({ label = 'Chargement…', size = 34 }: { label?: string; size?: number }) {
  return (
    <div className="min-h-[180px] w-full py-16 flex flex-col items-center justify-center gap-3 text-faint text-sm text-center">
      <Spinner size={size} stroke={4} color="currentColor" />
      <span className="font-semibold tracking-wide">{label}</span>
    </div>
  )
}

export function LoadingScreen({ label = 'Chargement…' }: { label?: string }) {
  return (
    <main className="flex-grow min-h-[55vh] flex items-center justify-center p-8 text-faint">
      <LoadingBlock label={label} size={38} />
    </main>
  )
}
