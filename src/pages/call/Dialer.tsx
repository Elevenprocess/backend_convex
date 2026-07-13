import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/shell/AppShell'
import { Topbar } from '../../components/shell/Topbar'
import { Icon } from '../../components/Icon'
import { LeadFiltersBar } from '../../components/LeadFiltersBar'
import { useLeads, useStartCall } from '../../lib/hooks'
import { DEFAULT_LEAD_FILTERS, applyLeadFilters, type LeadListFilters } from '../../lib/leadFilters'
import { normalizeSearchText, phoneMatches, phoneSearchVariants } from '../../lib/searchText'
import { fullName, type LeadResponse } from '../../lib/types'

const KEYS = ['1','2','3','4','5','6','7','8','9','+','0','⌫']

export function Dialer() {
  const navigate = useNavigate()
  const startCall = useStartCall()
  const { data: leads = [] } = useLeads({ limit: 500 })
  const [number, setNumber] = useState('')
  const [query, setQuery] = useState('')
  const [leadFilters, setLeadFilters] = useState<LeadListFilters>(DEFAULT_LEAD_FILTERS)

  const matches = useMemo(() => {
    // Recherche insensible à la casse/accents ; le pavé numérique matche les
    // numéros quels que soient les espaces et le préfixe (+262/+33 ↔ 0…).
    const q = normalizeSearchText(query)
    const qPhoneVariants = phoneSearchVariants(query)
    const padVariants = phoneSearchVariants(number)
    const digits = number.replace(/\D/g, '')
    return applyLeadFilters(leads ?? [], leadFilters)
      .filter((l) => {
        const hay = normalizeSearchText(
          [fullName(l), l.email, l.city, l.addressLine, l.postalCode].filter(Boolean).join(' '),
        )
        const textMatch = Boolean(q) && hay.includes(q)
        const queryPhoneMatch = phoneMatches(qPhoneVariants, l.phone)
        const padMatch = digits
          ? phoneMatches(padVariants, l.phone) || (l.phone ?? '').replace(/\D/g, '').includes(digits)
          : false
        return textMatch || queryPhoneMatch || padMatch || (!q && qPhoneVariants.length === 0 && !digits)
      })
      .slice(0, 8)
  }, [leads, leadFilters, query, number])

  const press = (k: string) => {
    if (k === '⌫') setNumber((n) => n.slice(0, -1))
    else setNumber((n) => `${n}${k}`)
  }

  const callLead = (lead: LeadResponse) => {
    if (!lead.phone) return
    startCall({ leadId: lead.id, leadName: fullName(lead), toNumber: lead.phone }).catch((err) => {
      console.error('Phone copy failed', err)
      alert(err instanceof Error ? err.message : 'Impossible de copier le numéro')
    })
  }

  return (
    <AppShell blobsKey="setter">
      <Topbar eyebrow="APPEL" title="Composer un numéro" />
      <main className="p-8 grid grid-cols-12 gap-6 flex-grow overflow-auto">
        <section className="glass-card col-span-5 p-7 flex flex-col items-center justify-between min-h-[620px]">
          <div className="text-center">
            <span className="eyebrow">NUMÉRO MANUEL</span>
            <div className="mt-4 font-mono text-[34px] font-bold tracking-wider min-h-[52px]">
              {number || '—'}
            </div>
            <p className="text-xs text-faint mt-2">Compose ou sélectionne un lead à droite.</p>
          </div>

          <div className="grid grid-cols-3 gap-3 w-full max-w-[300px]">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => press(k)}
                className="h-16 rounded-2xl bg-white/80 border border-line hover:bg-or hover:text-white transition-colors text-xl font-bold shadow-sm"
              >
                {k}
              </button>
            ))}
          </div>

          <div className="w-full max-w-[320px] space-y-3">
            <button
              disabled={!number}
              onClick={() => navigate(`/call/split?number=${encodeURIComponent(number)}`)}
              className="btn-primary w-full rounded-2xl py-4 flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Icon name="phone" size={18} />
              Lancer l'appel manuel
            </button>
            <button onClick={() => setNumber('')} className="btn-secondary w-full rounded-2xl py-3 text-sm">Effacer</button>
          </div>
        </section>

        <section className="glass-card col-span-7 p-6 min-h-[620px]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <span className="eyebrow">AIRTABLE MODE</span>
              <h3 className="font-bold text-lg">Choisir dans les leads</h3>
            </div>
            <span className="status-badge bg-or-tint text-or-dark">{(leads ?? []).length} leads chargés</span>
          </div>
          <div className="relative mb-4">
            <Icon name="search" size={16} className="absolute left-3 top-3 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par nom, ville, téléphone…"
              className="w-full bg-white border border-line rounded-[14px] pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-or"
            />
          </div>
          <LeadFiltersBar filters={leadFilters} onChange={setLeadFilters} total={(leads ?? []).length} filtered={matches.length} className="mb-4" />
          <div className="space-y-2.5 max-h-[480px] overflow-auto pr-1">
            {matches.map((l) => (
              <button
                key={l.id}
                onClick={() => callLead(l)}
                disabled={!l.phone}
                className="w-full p-4 rounded-2xl bg-white/55 border border-line-soft hover:border-or hover:bg-or-tint transition-colors flex items-center justify-between text-left"
              >
                <div>
                  <div className="font-semibold text-sm">{fullName(l)}</div>
                  <div className="text-xs text-muted mt-0.5">{l.phone ?? 'Sans téléphone'} · {l.city ?? 'Ville inconnue'}</div>
                </div>
                <span className="w-10 h-10 rounded-full bg-text text-white flex items-center justify-center"><Icon name="phone" size={16} /></span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  )
}
