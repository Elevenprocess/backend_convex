// Choix du jour et de l'heure d'arrivée au bureau (RDV bureau d'une promo).
// Les places viennent EN DIRECT du funnel d'inscription : « Plus que N places »
// à partir de 5, « Complet » non cliquable, comme sur le site des prospects.
import { Icon } from '../Icon'
import { dayPlacesLeft, FEW_PLACES, placesLabel, slotKey, type FunnelAvailability } from '../../lib/funnelSlots'

const WEEKDAYS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function dayParts(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  return { weekday: WEEKDAYS[d.getUTCDay()], date: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] }
}

type Props = {
  days: readonly string[]
  hoursOf: (day: string) => number[]
  selectedDay: string
  selectedHour: number | null
  onDay: (day: string) => void
  onHour: (hour: number) => void
  availability: FunnelAvailability | null
  /** Créneau pris par le prospect lui-même sur le site (repère visuel). */
  siteSlot?: { day: string; hour: number } | null
}

export function OfficeSlotPicker({ days, hoursOf, selectedDay, selectedHour, onDay, onHour, availability, siteSlot }: Props) {
  const hours = hoursOf(selectedDay)
  const groups = [
    { label: 'Matin', hours: hours.filter((h) => h < 12) },
    { label: 'Après-midi', hours: hours.filter((h) => h >= 12) },
  ].filter((g) => g.hours.length > 0)

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-faint">Jour du RDV au bureau</span>
          {availability ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />Places en direct du site
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {days.map((day) => {
            const { weekday, date, month } = dayParts(day)
            const left = dayPlacesLeft(availability, day, hoursOf(day))
            const full = left === 0
            const active = selectedDay === day
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                onClick={() => onDay(day)}
                className={`group relative flex flex-col items-start rounded-2xl border px-3 py-2.5 text-left transition ${
                  active
                    ? 'border-or bg-or text-white shadow-sm'
                    : 'border-line bg-white/80 text-text hover:border-or/50 hover:bg-white'
                }`}
              >
                <span className={`text-[11px] font-bold uppercase tracking-wider ${active ? 'text-white/80' : 'text-muted'}`}>{weekday}</span>
                <span className="flex items-baseline gap-1">
                  <span className="text-2xl font-black leading-none">{date}</span>
                  <span className={`text-xs font-semibold ${active ? 'text-white/80' : 'text-muted'}`}>{month}</span>
                </span>
                {left !== null && (
                  <span className={`mt-1.5 text-[11px] font-semibold ${
                    active ? 'text-white/90' : full ? 'text-rouille' : 'text-faint'
                  }`}>
                    {full ? 'Complet' : `${left} place${left > 1 ? 's' : ''}`}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-faint">Heure d’arrivée au bureau</div>
        {hours.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">Plus aucune heure possible ce jour-là.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                  <Icon name={g.label === 'Matin' ? 'sun' : 'clock'} size={12} />{g.label}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {g.hours.map((h) => {
                    const left = availability?.get(slotKey(selectedDay, h))
                    const full = left !== undefined && left <= 0
                    const few = left !== undefined && left > 0 && left <= FEW_PLACES
                    const label = placesLabel(left)
                    const active = selectedHour === h
                    const fromSite = siteSlot?.day === selectedDay && siteSlot.hour === h
                    return (
                      <button
                        key={h}
                        type="button"
                        disabled={full && !fromSite}
                        aria-pressed={active}
                        onClick={() => onHour(h)}
                        className={`relative flex min-h-[56px] flex-col justify-center rounded-xl border px-3 py-2 text-left transition ${
                          active
                            ? 'border-or bg-or-tint ring-2 ring-or'
                            : full && !fromSite
                              ? 'cursor-not-allowed border-line-soft bg-cream/60 opacity-60'
                              : 'border-line bg-white/80 hover:border-or/50 hover:bg-white'
                        }`}
                      >
                        <span className={`text-sm font-bold ${full && !fromSite ? 'text-faint line-through' : 'text-text'}`}>
                          {h} h – {h + 1} h
                        </span>
                        <span className={`text-[11px] font-semibold ${
                          full ? 'text-rouille' : few ? 'text-cuivre' : fromSite ? 'text-or-dark' : 'text-faint'
                        }`}>
                          {fromSite ? (label ? `Choisi sur le site · ${label}` : 'Choisi sur le site') : label ?? 'Disponible'}
                        </span>
                        {active && (
                          <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-or text-white">
                            <Icon name="check" size={10} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
