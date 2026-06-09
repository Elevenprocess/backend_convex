import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { LoadingBlock } from '../../components/Spinner'
import { useClients } from '../../lib/hooks'
import { buildTechnicienEvents, type TechCalendarEvent } from '../../lib/technicienCalendar'

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function monthCells(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - offset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

export function TechnicienPlanning() {
  const navigate = useNavigate()
  const { data: clients, loading } = useClients({})
  const [cursor, setCursor] = useState(() => new Date())

  const eventsByDay = useMemo(() => {
    const map = new Map<string, TechCalendarEvent[]>()
    for (const e of buildTechnicienEvents(clients ?? [])) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [clients])

  const cells = useMemo(() => monthCells(cursor), [cursor])
  const todayKey = ymd(new Date())

  const upcoming = useMemo(
    () => buildTechnicienEvents(clients ?? []).filter((e) => e.date >= todayKey).slice(0, 8),
    [clients, todayKey],
  )

  return (
    <AppShell>
      <Topbar eyebrow="PLANNING" title="Mes interventions" />
      <main className="p-4 sm:p-6 md:p-8 flex-grow overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <button className="btn-secondary p-2 rounded-xl" aria-label="Mois précédent"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
          <h2 className="font-black text-lg">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
          <button className="btn-secondary p-2 rounded-xl" aria-label="Mois suivant"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
          <button className="btn-secondary px-3 py-2 rounded-xl text-xs ml-2"
            onClick={() => setCursor(new Date())}>Aujourd'hui</button>
          <div className="ml-auto flex items-center gap-3 text-[11px] font-bold text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> VT</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Installation</span>
          </div>
        </div>

        {loading && !clients ? (
          <LoadingBlock label="Chargement du planning…" />
        ) : (
          <div className="glass-card !p-0 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line-soft">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-2 py-2 text-center eyebrow text-[10px] text-faint">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((d) => {
                const key = ymd(d)
                const list = eventsByDay.get(key) ?? []
                const muted = d.getMonth() !== cursor.getMonth()
                const isToday = key === todayKey
                return (
                  <div key={key} className={`min-h-[88px] border-l border-t border-line-soft p-1.5 flex flex-col gap-1 ${muted ? 'bg-white/30 text-faint' : 'bg-white/55'} ${isToday ? 'ring-2 ring-cuivre ring-inset' : ''}`}>
                    <span className="text-xs font-bold">{d.getDate()}</span>
                    {list.map((e) => (
                      <button key={`${e.clientId}-${e.type}`} onClick={() => navigate(`/suivi/${e.leadId}`)}
                        title={`${e.type === 'vt' ? 'VT' : 'Installation'} — ${e.clientName}${e.city ? ` · ${e.city}` : ''}`}
                        className={`text-left text-[10px] font-semibold rounded px-1.5 py-1 truncate text-white ${e.type === 'vt' ? 'bg-sky-500' : 'bg-emerald-500'}`}>
                        {e.clientName}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <section className="mt-6">
          <h3 className="eyebrow text-or-dark mb-2">Prochaines interventions</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">Aucune intervention planifiée.</p>
          ) : (
            <ul className="divide-y divide-line-soft glass-card !p-0 overflow-hidden">
              {upcoming.map((e) => (
                <li key={`${e.clientId}-${e.type}-${e.date}`}>
                  <button onClick={() => navigate(`/suivi/${e.leadId}`)}
                    className="w-full text-left px-4 py-3 hover:bg-cream/60 flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${e.type === 'vt' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                    <span className="font-bold">{e.clientName}</span>
                    <span className="text-xs text-muted">{e.type === 'vt' ? 'VT' : 'Installation'}{e.city ? ` · ${e.city}` : ''}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted">{e.date}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  )
}
