// Logo VELORA animé : le V se trace comme un trait (effet « stroke » After Effects),
// les deux anneaux se dessinent autour. L'animation est portée par le CSS
// (stroke-dashoffset) ; on la rejoue en changeant la `key` du composant côté Sidebar
// (typiquement à chaque navigation = moment de « chargement »).
export function VeloraMark() {
  return (
    <svg
      className="velora-mark"
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="VELORA"
    >
      <defs>
        <linearGradient id="velora-v-grad" x1="80" y1="78" x2="160" y2="170" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3FB9F2" />
          <stop offset="1" stopColor="#1D6FA3" />
        </linearGradient>
      </defs>

      {/* Grand anneau (fin) */}
      <circle className="velora-ring velora-ring--lg" cx="120" cy="120" r="104"
        fill="none" stroke="#1D6FA3" strokeWidth="3" strokeOpacity="0.55" />

      {/* Petit anneau (épais, or) */}
      <circle className="velora-ring velora-ring--sm" cx="120" cy="120" r="82"
        fill="none" stroke="#C9A14A" strokeWidth="7" />

      {/* Le V — se trace comme un trait */}
      <path className="velora-v" d="M86 86 L120 156 L154 86"
        fill="none" stroke="url(#velora-v-grad)" strokeWidth="16"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
