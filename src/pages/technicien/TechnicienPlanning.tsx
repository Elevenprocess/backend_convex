import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { LoadingBlock } from '../../components/Spinner'
import { useUsers, useVtCalendar } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import type { VtCalendarEntry } from '../../lib/types'

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
  const [cursor, setCursor] = useState(() => new Date())

  const cells = useMemo(() => monthCells(cursor), [cursor])
  const todayKey = ymd(new Date())

  // Source de vérité des interventions = /clients/vt-calendar (la date VT est
  // calculée depuis les sous-étapes vt_planifie/vt_attribuee, ce que la dérivation
  // côté clients ne voyait pas → une VT planifiée n'apparaissait pas au planning).
  const from = ymd(cells[0])
  const to = ymd(cells[cells.length - 1])
  const { data: entries, loading } = useVtCalendar({ from, to })

  // Un technicien voit déjà son propre planning (scope serveur). Les rôles
  // delivery/ops voient tous les dossiers → sélecteur pour afficher le programme
  // d'UN technicien (ses VT + ses installations).
  const role = useAuth((s) => s.user?.role)
  const isTech = role === 'technicien'
  const { data: users } = useUsers()
  const technicians = useMemo(
    () => (users ?? []).filter((u) => u.role === 'technicien').sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [users],
  )
  const [selectedTechId, setSelectedTechId] = useState('')

  const events = useMemo(
    () => (selectedTechId ? (entries ?? []).filter((e) => e.technicienId === selectedTechId) : (entries ?? [])),
    [entries, selectedTechId],
  )

  const eventsByDay = useMemo(() => {
    const map = new Map<string, VtCalendarEntry[]>()
    for (const e of events) {
      const list = map.get(e.date) ?? []
      list.push(e)
      map.set(e.date, list)
    }
    return map
  }, [events])

  const upcoming = useMemo(
    () => [...events].filter((e) => e.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8),
    [events, todayKey],
  )

  return (
    <AppShell>
      <Topbar eyebrow="PLANNING" title={isTech ? 'Mes interventions' : 'Planning techniciens'} />
      <main className="p-4 sm:p-6 md:p-8 flex-grow overflow-y-auto">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button className="btn-secondary p-2 rounded-xl" aria-label="Mois précédent"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
          <h2 className="font-black text-lg">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
          <button className="btn-secondary p-2 rounded-xl" aria-label="Mois suivant"
            onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
          <button className="btn-secondary px-3 py-2 rounded-xl text-xs ml-2"
            onClick={() => setCursor(new Date())}>Aujourd'hui</button>
          {!isTech && (
            <select
              value={selectedTechId}
              onChange={(e) => setSelectedTechId(e.target.value)}
              aria-label="Filtrer par technicien"
              className="ml-auto px-3 py-2 rounded-xl text-xs font-semibold border border-line bg-white max-w-[220px]"
            >
              <option value="">Tous les techniciens</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
              ))}
            </select>
          )}
          <div className={`${isTech ? 'ml-auto' : ''} flex items-center gap-3 text-[11px] font-bold text-muted`}>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> VT</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Installation</span>
          </div>
        </div>

        {loading && !entries ? (
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
                      <button key={`${e.clientId}-${e.kind}`} onClick={() => navigate(`/suivi/${e.leadId}`)}
                        title={`${e.kind === 'vt' ? 'VT' : 'Installation'} — ${e.leadName}${e.city ? ` · ${e.city}` : ''}`}
                        className={`text-left text-[10px] font-semibold rounded px-1.5 py-1 truncate text-white ${e.kind === 'vt' ? 'bg-sky-500' : 'bg-emerald-500'}`}>
                        {e.leadName}
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
                <li key={`${e.clientId}-${e.kind}-${e.date}`}>
                  <button onClick={() => navigate(`/suivi/${e.leadId}`)}
                    className="w-full text-left px-4 py-3 hover:bg-cream/60 flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${e.kind === 'vt' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                    <span className="font-bold">{e.leadName}</span>
                    <span className="text-xs text-muted">{e.kind === 'vt' ? 'VT' : 'Installation'}{e.city ? ` · ${e.city}` : ''}</span>
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
