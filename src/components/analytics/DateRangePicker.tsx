import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon'
import {
  PERIOD_OPTIONS, buildPeriodRange, parseDateInput, toDateInputValue,
  startOfDay, endOfDay, addDays, formatShortDate,
  type PeriodState, type PeriodMode,
} from '../../lib/period'

type Props = {
  value: PeriodState
  onChange: (next: PeriodState) => void
  align?: 'left' | 'right'
}

const DOW = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di']

function monthMatrix(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const startDow = (first.getDay() || 7) - 1
  const start = addDays(first, -startDow)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function DateRangePicker({ value, onChange, align = 'left' }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PeriodState>(value)
  const [view, setView] = useState(() => new Date())
  // Étape de sélection : 'start' = on place le curseur bleu (entrant),
  // 'end' = on place le curseur vert (sortant). `hover` prévisualise la plage.
  const [picking, setPicking] = useState<'start' | 'end'>('start')
  const [hover, setHover] = useState<Date | null>(null)
  // Mode « une seule journée » : un clic sélectionne le jour cliqué (début = fin),
  // sans attendre de second clic pour la date de fin.
  const [singleDay, setSingleDay] = useState(false)
  // Glisser-déposer d'un curseur : 'start'/'end' = le curseur qu'on déplace,
  // null = pas de drag en cours. dragAnchor garde le curseur opposé (fixe) pendant
  // le glissé. didDrag distingue un vrai déplacement d'un simple clic (pour ne pas
  // re-déclencher la logique de clic au relâchement).
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)
  const dragAnchor = useRef<string | undefined>(undefined)
  const didDrag = useRef(false)
  const ref = useRef<HTMLDivElement>(null)

  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(value)
      setPicking('start')
      setHover(null)
      setDragging(null)
      didDrag.current = false
      // Pré-active le mode jour unique si la valeur courante est déjà une seule journée.
      setSingleDay(value.mode === 'custom' && !!value.customFrom && value.customFrom === value.customTo)
    }
    wasOpen.current = open
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Fin du glissé même si on relâche hors de la grille (souris sortie du calendrier).
  useEffect(() => {
    if (!dragging) return
    const onUp = () => setDragging(null)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [dragging])

  const draftRange = useMemo(() => buildPeriodRange(draft), [draft])
  const today = startOfDay(new Date())
  const prevView = new Date(view.getFullYear(), view.getMonth() - 1, 1)

  function selectPreset(mode: PeriodMode) {
    setPicking('start')
    setHover(null)
    if (mode === 'last_n_days') {
      setDraft((d) => ({ ...d, mode, lastN: d.lastN ?? 30, includeToday: d.includeToday ?? true }))
    } else {
      setDraft((d) => ({ ...d, mode }))
    }
  }

  // Sélection à deux curseurs :
  //  • 1er clic (ou après une plage déjà complète) → pose le DÉBUT (bleu),
  //    on passe en attente de la FIN.
  //  • 2e clic → pose la FIN (vert). Si on clique AVANT le début, on inverse
  //    intelligemment : le plus tôt devient le bleu, l'ancien début le vert.
  function toggleSingleDay(on: boolean) {
    setSingleDay(on)
    setPicking('start')
    setHover(null)
    // En activant, on replie la plage courante sur sa date de début.
    if (on && draft.mode === 'custom' && draft.customFrom) {
      setDraft((d) => ({ ...d, customTo: d.customFrom }))
    }
  }

  function clickDay(day: Date) {
    if (day > today) return
    // On vient de relâcher un glissé : le clic qui suit ne doit pas re-sélectionner.
    if (didDrag.current) { didDrag.current = false; return }
    const iso = toDateInputValue(day)
    // Mode jour unique : un seul clic fixe début ET fin sur le jour cliqué.
    if (singleDay) {
      setDraft((d) => ({ ...d, mode: 'custom', customFrom: iso, customTo: iso }))
      setPicking('start')
      setHover(null)
      return
    }
    const hasRange = draft.mode === 'custom' && !!draft.customFrom
    // 2e clic : on pose la fin (avec inversion si on clique avant le début).
    if (picking === 'end' && hasRange) {
      const from = parseDateInput(draft.customFrom!)
      setDraft((d) =>
        day < from
          ? { ...d, mode: 'custom', customFrom: iso, customTo: d.customFrom }
          : { ...d, mode: 'custom', customFrom: d.customFrom, customTo: iso },
      )
      setPicking('start')
      setHover(null)
      return
    }
    // Plage déjà complète : un clic supplémentaire déplace le curseur le plus proche
    // au lieu de tout recommencer (3e clic, 4e clic… ajustent la plage existante).
    if (hasRange) {
      const from = parseDateInput(draft.customFrom!)
      const to = parseDateInput(draft.customTo ?? draft.customFrom!)
      const closerToStart = Math.abs(day.getTime() - from.getTime()) <= Math.abs(day.getTime() - to.getTime())
      setDraft((d) => {
        if (closerToStart) {
          // Déplace le début ; s'il dépasse la fin, les deux s'inversent.
          return day > to
            ? { ...d, mode: 'custom', customFrom: d.customTo ?? d.customFrom, customTo: iso }
            : { ...d, mode: 'custom', customFrom: iso }
        }
        // Déplace la fin ; si elle passe avant le début, les deux s'inversent.
        return day < from
          ? { ...d, mode: 'custom', customFrom: iso, customTo: d.customFrom }
          : { ...d, mode: 'custom', customTo: iso }
      })
      setPicking('start')
      setHover(null)
      return
    }
    // Aucune plage (preset actif / première ouverture) : on pose le début.
    setDraft((d) => ({ ...d, mode: 'custom', customFrom: iso, customTo: iso }))
    setPicking('end')
    setHover(null)
  }

  // Appui sur un curseur (début ou fin) : démarre le glissé. Le curseur opposé
  // reste ancré ; on recalcule la plage comme min/max(ancre, jour survolé).
  function onDayMouseDown(day: Date) {
    if (singleDay || day > today) return
    if (draft.mode !== 'custom' || !draft.customFrom) return
    const iso = toDateInputValue(day)
    const isStart = draft.customFrom === iso
    const isEnd = (draft.customTo ?? draft.customFrom) === iso
    if (!isStart && !isEnd) return
    const edge: 'start' | 'end' = isEnd ? 'end' : 'start'
    dragAnchor.current = edge === 'end' ? draft.customFrom : (draft.customTo ?? draft.customFrom)
    didDrag.current = false
    setDragging(edge)
  }

  function onDayMouseEnter(day: Date) {
    if (day > today) return
    if (dragging && dragAnchor.current) {
      didDrag.current = true
      const anchor = parseDateInput(dragAnchor.current)
      const [a, b] = day < anchor ? [day, anchor] : [anchor, day]
      setDraft((d) => ({ ...d, mode: 'custom', customFrom: toDateInputValue(a), customTo: toDateInputValue(b) }))
      return
    }
    if (picking === 'end') setHover(day)
  }

  // Plage affichée : pendant le choix de la fin, on prévisualise jusqu'au jour survolé.
  const preview = useMemo(() => {
    if (draft.mode === 'custom' && picking === 'end' && hover && draft.customFrom) {
      const from = parseDateInput(draft.customFrom)
      const [a, b] = hover < from ? [hover, from] : [from, hover]
      return { from: a, to: b }
    }
    return { from: new Date(draftRange.from), to: new Date(draftRange.to) }
  }, [draft, picking, hover, draftRange])

  function edgeKind(day: Date): 'start' | 'end' | null {
    const iso = toDateInputValue(day)
    if (iso === toDateInputValue(preview.from)) return 'start'
    if (iso === toDateInputValue(preview.to)) return 'end'
    return null
  }
  function inRange(day: Date) {
    const t = startOfDay(day).getTime()
    return t >= startOfDay(preview.from).getTime()
      && t <= endOfDay(preview.to).getTime()
  }

  function renderCal(viewDate: Date, side: 'left' | 'right') {
    return (
      <div className="drp-cal">
        <div className="drp-cal-head">
          {side === 'left' ? (
            <button type="button" className="drp-nav" aria-label="Mois précédent"
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}>‹</button>
          ) : <span className="drp-nav" aria-hidden style={{ visibility: 'hidden' }}>‹</span>}
          <strong>{viewDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</strong>
          {side === 'right' ? (
            <button type="button" className="drp-nav" aria-label="Mois suivant"
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}>›</button>
          ) : <span className="drp-nav" aria-hidden style={{ visibility: 'hidden' }}>›</span>}
        </div>
        <div className="drp-grid">
          {DOW.map((d) => <span key={d} className="drp-dow">{d}</span>)}
          {monthMatrix(viewDate).map((day) => {
            const inMonth = day.getMonth() === viewDate.getMonth()
            const disabled = day > today
            const edge = edgeKind(day)
            const cls = [
              'drp-day',
              edge === 'start' ? 'edge edge-start' : edge === 'end' ? 'edge edge-end' : inRange(day) ? 'in-range' : '',
            ].join(' ')
            return (
              <button key={day.toISOString()} type="button" className={cls} disabled={disabled}
                style={{ opacity: inMonth ? 1 : 0.4 }}
                onMouseDown={() => onDayMouseDown(day)}
                onClick={() => clickDay(day)}
                onMouseEnter={() => onDayMouseEnter(day)}>
                {day.getDate()}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="drp-trigger" aria-label="Période" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" size={16} />
        <span>{buildPeriodRange(value).label.split(' · ')[0]}</span>
        <span aria-hidden>⌄</span>
      </button>

      {open && (
        <div className={`drp-panel ${align === 'right' ? 'drp-panel--right' : ''} ${dragging ? 'is-dragging' : ''}`}>
          <div className="drp-presets">
            <div className="drp-group">
              <span className="drp-group-title">Période à ce jour</span>
              {(['this_week', 'this_month', 'this_year'] as PeriodMode[]).map((mode) => (
                <button key={mode} type="button"
                  className={`drp-preset ${draft.mode === mode ? 'active' : ''}`}
                  onClick={() => selectPreset(mode)}>
                  {PERIOD_OPTIONS.find((o) => o.id === mode)?.label}
                </button>
              ))}
            </div>
            <div className="drp-group">
              <span className="drp-group-title">Dernier</span>
              {[7, 30, 90, 365].map((n) => (
                <button key={n} type="button"
                  className={`drp-preset ${draft.mode === 'last_n_days' && (draft.lastN ?? 30) === n ? 'active' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, mode: 'last_n_days', lastN: n, includeToday: d.includeToday ?? true }))}>
                  {n} derniers jours
                </button>
              ))}
              {(['last_week', 'last_month', 'last_year'] as PeriodMode[]).map((mode) => (
                <button key={mode} type="button"
                  className={`drp-preset ${draft.mode === mode ? 'active' : ''}`}
                  onClick={() => selectPreset(mode)}>
                  {PERIOD_OPTIONS.find((o) => o.id === mode)?.label}
                </button>
              ))}
            </div>
            <div className="drp-group">
              {(['today', 'yesterday'] as PeriodMode[]).map((mode) => (
                <button key={mode} type="button"
                  className={`drp-preset ${draft.mode === mode ? 'active' : ''}`}
                  onClick={() => selectPreset(mode)}>
                  {PERIOD_OPTIONS.find((o) => o.id === mode)?.label}
                </button>
              ))}
            </div>
          </div>
          <div className="drp-body">
            <div className="drp-lastn">
              <span>Dernier</span>
              <input type="number" min={1} value={draft.lastN ?? 30}
                onChange={(e) => setDraft((d) => ({ ...d, mode: 'last_n_days', lastN: Math.max(1, Number(e.target.value) || 1), includeToday: d.includeToday ?? true }))} />
              <span>jours</span>
              <label className="drp-include">
                <input type="checkbox" checked={draft.includeToday ?? true}
                  onChange={(e) => setDraft((d) => ({ ...d, mode: 'last_n_days', lastN: d.lastN ?? 30, includeToday: e.target.checked }))} />
                Inclure aujourd'hui
              </label>
            </div>
            <label className="drp-include drp-single">
              <input type="checkbox" checked={singleDay}
                onChange={(e) => toggleSingleDay(e.target.checked)} />
              Sélectionner une seule journée
            </label>
            <div className="drp-cals">
              {renderCal(prevView, 'left')}
              {renderCal(view, 'right')}
            </div>
            <div className="drp-foot">
              <span className="drp-foot-label">
                <span className={`drp-cursor drp-cursor--start ${picking === 'start' ? 'is-active' : ''}`}>
                  Début {formatShortDate(new Date(draftRange.from))}
                </span>
                <span className="drp-foot-sep">→</span>
                <span className={`drp-cursor drp-cursor--end ${picking === 'end' ? 'is-active' : ''}`}>
                  Fin {formatShortDate(new Date(draftRange.to))}
                </span>
              </span>
              <div className="drp-actions">
                <button type="button" className="drp-btn" onClick={() => setOpen(false)}>Annuler</button>
                <button type="button" className="drp-btn drp-btn--primary"
                  onClick={() => { onChange(draft); setOpen(false) }}>Appliquer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
