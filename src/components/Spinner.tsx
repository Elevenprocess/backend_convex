type SpinnerProps = {
  size?: number | string
  stroke?: number | string
  speed?: number | string
  color?: string
  label?: string
  className?: string
}

export function Spinner({
  size = 22,
  stroke = 3,
  speed = 0.8,
  color = 'currentColor',
  label,
  className,
}: SpinnerProps) {
  const px = typeof size === 'number' ? `${size}px` : size
  const border = typeof stroke === 'number' ? `${stroke}px` : stroke
  const duration = typeof speed === 'number' ? `${speed}s` : speed

  return (
    <span className={`inline-flex items-center gap-2 align-middle ${className ?? ''}`}>
      <span
        className="inline-block rounded-full border-current border-t-transparent animate-spin"
        style={{ width: px, height: px, borderWidth: border, color, animationDuration: duration }}
        aria-hidden="true"
      />
      {label && <span>{label}</span>}
    </span>
  )
}

export function LoadingBlock({ label = 'Chargement…', size = 32 }: { label?: string; size?: number }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3 text-faint text-sm">
      <Spinner size={size} stroke={3} />
      <span>{label}</span>
    </div>
  )
}
