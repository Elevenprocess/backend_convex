// frontend/src/components/promotions/PromotionForm.tsx
import { useEffect, useState } from 'react'
import { createPromotion, listGhlCalendars, updatePromotion, type PromotionInput, type PromotionRow } from '../../lib/promotionsApi'
import { reunionDayInput } from '../../lib/promotions'
import { humanizeError } from '../../lib/hooks'

export const LEGACY_STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: 'perdu', label: 'Perdu' },
  { key: 'pas_qualifie', label: 'Pas qualifié' },
  { key: 'pas_de_reponse', label: 'Sans réponse' },
  { key: 'relance', label: 'Relance long terme' },
  { key: 'a_rappeler', label: 'À rappeler' },
  { key: 'nouveau', label: 'Nouveau (jamais traité)' },
]

export type PromotionFormValues = {
  name: string; tag: string; startDay: string; endDay: string; offer: string; pitch: string
  officeCalendarId: string; officeAddress: string; legacyStatuses: string[]
  legacyArrivedFromDay: string; legacyArrivedToDay: string
}

export const EMPTY_PROMOTION_FORM: PromotionFormValues = {
  name: '', tag: '', startDay: '', endDay: '', offer: '', pitch: '',
  officeCalendarId: '', officeAddress: '', legacyStatuses: [], legacyArrivedFromDay: '', legacyArrivedToDay: '',
}

export function validatePromotionForm(v: PromotionFormValues): string | null {
  if (!v.name.trim()) return 'Le nom de la promotion est obligatoire.'
  if (!v.startDay || !v.endDay) return 'Choisis une date de début et une date de fin.'
  if (v.endDay < v.startDay) return 'La date de fin doit être après la date de début.'
  return null
}

function toInput(v: PromotionFormValues): PromotionInput {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined)
  return {
    name: v.name.trim(), tag: opt(v.tag), startDay: v.startDay, endDay: v.endDay,
    offer: opt(v.offer), pitch: opt(v.pitch), officeCalendarId: opt(v.officeCalendarId), officeAddress: opt(v.officeAddress),
    legacyStatuses: v.legacyStatuses.length ? v.legacyStatuses : undefined,
    legacyArrivedFromDay: opt(v.legacyArrivedFromDay), legacyArrivedToDay: opt(v.legacyArrivedToDay),
  }
}

function fromRow(p: PromotionRow): PromotionFormValues {
  return {
    name: p.name, tag: p.tag ?? '', startDay: reunionDayInput(p.startAt), endDay: reunionDayInput(p.endAt),
    offer: p.offer ?? '', pitch: p.pitch ?? '', officeCalendarId: p.officeCalendarId ?? '', officeAddress: p.officeAddress ?? '',
    legacyStatuses: p.legacyStatuses ?? [],
    legacyArrivedFromDay: p.legacyArrivedFrom ? reunionDayInput(p.legacyArrivedFrom) : '',
    legacyArrivedToDay: p.legacyArrivedTo ? reunionDayInput(p.legacyArrivedTo) : '',
  }
}

export function PromotionForm({ initial, onClose, onSaved }: { initial?: PromotionRow; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<PromotionFormValues>(() => (initial ? fromRow(initial) : EMPTY_PROMOTION_FORM))
  const [calendars, setCalendars] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    listGhlCalendars().then((rows) => {
      setCalendars(rows)
      // Pré-remplissage : le calendrier « Black Friday » s'il existe.
      if (!initial) {
        const bf = rows.find((c) => c.name.toLowerCase().includes('black friday'))
        if (bf) setValues((v) => (v.officeCalendarId ? v : { ...v, officeCalendarId: bf.id }))
      }
    }).catch(() => setCalendars([]))
  }, [initial])
  const set = <K extends keyof PromotionFormValues>(k: K, val: PromotionFormValues[K]) => setValues((v) => ({ ...v, [k]: val }))

  async function save() {
    const invalid = validatePromotionForm(values)
    if (invalid) return setError(invalid)
    setSaving(true); setError(null)
    try {
      if (initial) await updatePromotion(initial._id, toInput(values))
      else await createPromotion(toInput(values))
      onSaved()
    } catch (e) {
      setError(humanizeError(e, 'Enregistrement impossible'))
    } finally {
      setSaving(false)
    }
  }

  const field = 'bg-white border border-line rounded-[14px] px-3 py-2 text-sm w-full'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label="Promotion">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[22px] bg-white p-5 space-y-4">
        <h2 className="font-black text-lg">{initial ? 'Modifier la promotion' : 'Nouvelle promotion'}</h2>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Général</div>
          <input className={field} placeholder="Nom (ex. Black Friday 2026)" value={values.name} onChange={(e) => set('name', e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Début<input type="date" className={field} value={values.startDay} onChange={(e) => set('startDay', e.target.value)} /></label>
            <label className="text-xs text-muted">Fin<input type="date" className={field} value={values.endDay} onChange={(e) => set('endDay', e.target.value)} /></label>
          </div>
          <input className={field} placeholder="Offre (ex. -15 % sur les kits)" value={values.offer} onChange={(e) => set('offer', e.target.value)} />
          <textarea className={`${field} h-24 resize-none`} placeholder="Argumentaire pour les setters" value={values.pitch} onChange={(e) => set('pitch', e.target.value)} />
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Nouveaux leads</div>
          <p className="text-xs text-muted">Après l’enregistrement, la carte de la promotion affiche un lien webhook à copier dans une action Webhook d’un workflow GHL : les contacts envoyés arrivent tout seuls dans l’onglet Promotion.</p>
          <input className={field} placeholder="Tag GHL (facultatif, ex. black friday)" value={values.tag} onChange={(e) => set('tag', e.target.value)} />
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">Anciens leads à inviter</div>
          <div className="flex flex-wrap gap-2">
            {LEGACY_STATUS_OPTIONS.map((s) => {
              const on = values.legacyStatuses.includes(s.key)
              return (
                <button key={s.key} type="button"
                  onClick={() => set('legacyStatuses', on ? values.legacyStatuses.filter((x) => x !== s.key) : [...values.legacyStatuses, s.key])}
                  className={`pill-tab text-xs ${on ? '!bg-text !text-white' : 'bg-white border border-line text-muted'}`}>
                  {s.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Arrivés depuis (facultatif)<input type="date" className={field} value={values.legacyArrivedFromDay} onChange={(e) => set('legacyArrivedFromDay', e.target.value)} /></label>
            <label className="text-xs text-muted">Arrivés jusqu’au (facultatif)<input type="date" className={field} value={values.legacyArrivedToDay} onChange={(e) => set('legacyArrivedToDay', e.target.value)} /></label>
          </div>
          <p className="text-xs text-muted">Le nombre de leads concernés et le bouton « Rattacher ces leads » apparaissent sur la carte de la promotion après l’enregistrement.</p>
        </section>

        <section className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-faint">RDV au bureau</div>
          <select className={field} value={values.officeCalendarId} onChange={(e) => set('officeCalendarId', e.target.value)}>
            <option value="">Pas de RDV au bureau</option>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className={field} placeholder="Adresse du bureau" value={values.officeAddress} onChange={(e) => set('officeAddress', e.target.value)} />
        </section>

        {error && <div className="rounded-[14px] border border-rouille/40 bg-rouille-tint px-3 py-2 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-line bg-white py-2 text-sm font-semibold">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary rounded-xl py-2 text-sm disabled:opacity-60">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}
