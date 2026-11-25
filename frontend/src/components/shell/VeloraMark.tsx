import { useId } from 'react'

// Logo VELORA « Prisme » : deux facettes en dégradé qui se croisent ; leur
// rencontre forme un triangle sombre (le pli). Animé dans la sidebar : les
// facettes glissent en place puis le pli apparaît (CSS `.velora-mark`), rejoué
// à chaque navigation via la `key` côté Sidebar. `animated={false}` = statique.
export function VeloraMark({ animated = true, className = '' }: { animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      className={`velora-mark ${animated ? 'is-animated' : ''} ${className}`}
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="VELORA"
    >
      <defs>
        <linearGradient id={`${id}-l`} x1="36" y1="48" x2="156" y2="208" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#34B27B" />
          <stop offset="1" stopColor="#1F7857" />
        </linearGradient>
        <linearGradient id={`${id}-r`} x1="220" y1="48" x2="100" y2="208" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A8E0BE" />
          <stop offset="1" stopColor="#3E9A6F" />
        </linearGradient>
      </defs>
      <path className="velora-facet velora-facet--l" fill={`url(#${id}-l)`} d="M36 48 H92 L156 208 H100 Z" />
      <path className="velora-facet velora-facet--r" fill={`url(#${id}-r)`} d="M220 48 H164 L100 208 H156 Z" />
      <path className="velora-fold" fill="#0B3B29" d="M128 138 L156 208 H100 Z" />
    </svg>
  )
}
