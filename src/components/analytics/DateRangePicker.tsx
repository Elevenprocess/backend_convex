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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) setDraft(value) }, [open, value])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const draftRange = useMemo(() => buildPeriodRange(draft), [draft])
  const today = startOfDay(new Date())
  const prevView = new Date(view.getFullYear(), view.getMonth() - 1, 1)

  function selectPreset(mode: PeriodMode) {
    if (mode === 'last_n_days') {
      setDraft((d) => ({ ...d, mode, lastN: d.lastN ?? 30, includeToday: d.includeToday ?? true }))
    } else {
      setDraft((d) => ({ ...d, mode }))
    }
  }

  function clickDay(day: Date) {
    if (day > today) return
    const iso = toDateInputValue(day)
    setDraft((d) => {
      if (d.mode !== 'custom' || (d.customFrom && d.customTo && d.customFrom !== d.customTo)) {
        return { ...d, mode: 'custom', customFrom: iso, customTo: iso }
      }
      const from = parseDateInput(d.customFrom)
      if (day < from) return { ...d, mode: 'custom', customFrom: iso, customTo: d.customFrom }
      return { ...d, mode: 'custom', customFrom: d.customFrom, customTo: iso }
    })
  }

  function isEdge(day: Date) {
    return toDateInputValue(day) === toDateInputValue(new Date(draftRange.from))
      || toDateInputValue(day) === toDateInputValue(new Date(draftRange.to))
  }
  function inRange(day: Date) {
    const t = startOfDay(day).getTime()
    return t >= startOfDay(new Date(draftRange.from)).getTime()
      && t <= endOfDay(new Date(draftRange.to)).getTime()
  }

  function renderCal(viewDate: Date) {
    return (
      <div className="drp-cal">
        <div className="drp-cal-head">
          <button type="button" className="drp-nav" aria-label="Mois précédent"
            onClick={() => setView(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>‹</button>
          <strong>{viewDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</strong>
          <button type="button" className="drp-nav" aria-label="Mois suivant"
            onClick={() => setView(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>›</button>
        </div>
        <div className="drp-grid">
          {DOW.map((d) => <span key={d} className="drp-dow">{d}</span>)}
          {monthMatrix(viewDate).map((day) => {
            const inMonth = day.getMonth() === viewDate.getMonth()
            const disabled = day > today
            const cls = ['drp-day', isEdge(day) ? 'edge' : inRange(day) ? 'in-range' : ''].join(' ')
            return (
              <button key={day.toISOString()} type="button" className={cls} disabled={disabled}
                style={{ opacity: inMonth ? 1 : 0.4 }} onClick={() => clickDay(day)}>
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
        <div className={`drp-panel ${align === 'right' ? 'drp-panel--right' : ''}`}>
          <div className="drp-presets">
            {PERIOD_OPTIONS.map((opt) => (
              <button key={opt.id} type="button"
                className={`drp-preset ${draft.mode === opt.id ? 'active' : ''}`}
                onClick={() => selectPreset(opt.id)}>
                {opt.label}
              </button>
            ))}
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
            <div className="drp-cals">
              {renderCal(prevView)}
              {renderCal(view)}
            </div>
            <div className="drp-foot">
              <span className="drp-foot-label">
                Du {formatShortDate(new Date(draftRange.from))} au {formatShortDate(new Date(draftRange.to))}
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
