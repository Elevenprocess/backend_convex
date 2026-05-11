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

// Wrapper autour de ldrs Hatch — couleur par défaut = currentColor pour hériter
// du texte parent (or sur fond clair, blanc sur boutons primary, etc.).
export function Spinner({
  size = 22,
  stroke = 3,
  speed = 3.5,
  color = 'currentColor',
  label,
  className,
}: SpinnerProps) {
  return (
    <span className={`inline-flex items-center gap-2 align-middle ${className ?? ''}`}>
      <Hatch size={String(size)} stroke={String(stroke)} speed={String(speed)} color={color} />
      {label && <span>{label}</span>}
    </span>
  )
}

// Bloc centré pour les écrans/sections en chargement plein.
export function LoadingBlock({ label = 'Chargement…', size = 32 }: { label?: string; size?: number }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-faint text-sm">
      <Hatch size={String(size)} stroke="3" speed="3.5" color="currentColor" />
      <span>{label}</span>
    </div>
  )
}
