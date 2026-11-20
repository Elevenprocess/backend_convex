import type { RdvLocation } from '../lib/types'

const LABEL: Record<RdvLocation, string> = { domicile: 'Domicile', agence: 'Bureau', visio: 'Visio' }

export function rdvLocationLabel(location: RdvLocation): string {
  return LABEL[location] ?? location
}

export function RdvLocationBadge({ location }: { location: RdvLocation }) {
  if (location === 'domicile') return null
  return (
    <span className="rounded-full bg-or-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-or-dark">
      {rdvLocationLabel(location)}
    </span>
  )
}
