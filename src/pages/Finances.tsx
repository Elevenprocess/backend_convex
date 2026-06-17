import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useAcomptes } from '../lib/hooks'
import { recordAcompte } from '../lib/api'
import { todayIso } from '../lib/suivi-board'
import { formatDate } from '../lib/suivi'
import { formatPaymentMethod } from '../lib/types'
import type { AcompteResponse, AcompteStatut } from '../lib/types'

const STATUT_META: Record<AcompteStatut, { label: string; cls: string }> = {
  attendu: { label: 'Attendu', cls: 'bg-cuivre-tint text-cuivre' },
  encaisse: { label: 'Encaissé', cls: 'bg-or-tint text-or-dark' },
  en_retard: { label: 'En retard', cls: 'bg-rouille-tint text-rouille' },
  annule: { label: 'Annulé', cls: 'bg-line text-faint' },
}

const FILTERS: Array<{ key: 'tous' | AcompteStatut; label: string }> = [
  { key: 'tous', label: 'Tous' },
  { key: 'attendu', label: 'Attendus' },
  { key: 'encaisse', label: 'Encaissés' },
  { key: 'en_retard', label: 'En retard' },
  { key: 'annule', label: 'Annulés' },
]

function money(v: string | null): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isNaN(n) ? '—' : `${n.toLocaleString('fr-FR')} €`
}

export function Finances() {
  const role = useAuth((s) => s.user?.role)
  const { data: acomptes, loading, refetch } = useAcomptes(role === 'admin' || role === 'finances')
  const [filter, setFilter] = useState<'tous' | AcompteStatut>('tous')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<AcompteResponse | null>(null)

  const rows = useMemo(() => {
    const list = acomptes ?? []
    const q = query.trim().toLowerCase()
    return list.filter((a) => {
      if (filter !== 'tous' && a.statut !== filter) return false
      if (q && !(a.clientName ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [acomptes, filter, query])

  const totals = useMemo(() => {
    const list = acomptes ?? []
    let attendu = 0
    let encaisse = 0
    let nbRetard = 0
    for (const a of list) {
      const att = Number(a.acompteAmount ?? 0) || 0
      const reel = Number(a.montantReel ?? 0) || 0
      if (a.statut === 'encaisse') encaisse += reel || att
      else if (a.statut === 'en_retard') { nbRetard += 1; attendu += att }
      else if (a.statut === 'attendu') attendu += att
    }
    return { attendu, encaisse, nbRetard }
  }, [acomptes])

  if (role && role !== 'admin' && role !== 'finances') return <Navigate to="/overview" replace />

  return (
    <AppShell flat>
      <Topbar eyebrow="FINANCES" title="Suivi des acomptes" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="glass-card p-4">
            <span className="eyebrow text-or-dark">Acomptes attendus</span>
            <p className="text-2xl font-black mt-1">{totals.attendu.toLocaleString('fr-FR')} €</p>
          </div>
          <div className="glass-card p-4">
            <span className="eyebrow text-or-dark">Encaissés</span>
            <p className="text-2xl font-black mt-1">{totals.encaisse.toLocaleString('fr-FR')} €</p>
          </div>
          <div className="glass-card p-4">
            <span className="eyebrow text-or-dark">En retard</span>
            <p className="text-2xl font-black mt-1">{totals.nbRetard}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${filter === f.key ? 'bg-or text-white' : 'bg-cream-darker text-muted hover:bg-line'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un client…"
            className="ml-auto rounded-lg border border-line px-3 py-2 text-sm bg-white min-w-[200px]"
          />
        </div>

        {loading ? (
          <LoadingBlock label="Chargement des acomptes…" />
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-faint">
            Aucun acompte {filter !== 'tous' ? `« ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} »` : ''}.
          </div>
        ) : (
          <div className="fin-table-wrap glass-card overflow-hidden">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Commercial</th>
                  <th>Montant total</th>
                  <th>Acompte</th>
                  <th>Méthode de paiement</th>
                  <th>Statut</th>
                  <th>Encaissé le</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const meta = STATUT_META[a.statut]
                  return (
                    <tr key={a.debriefId}>
                      <td className="font-semibold text-text">{a.clientName ?? '—'}</td>
                      <td className="text-muted">{a.commercialName ?? '—'}</td>
                      <td>{money(a.montantTotal)}</td>
                      <td className="font-semibold">
                        {money(a.acompteAmount)}
                        {a.acomptePercent != null && <span className="text-faint text-xs"> ({a.acomptePercent}%)</span>}
                      </td>
                      <td className="text-muted">{formatPaymentMethod(a.financingType, a.paymentSubMethod, a.financingOrg) ?? '—'}</td>
                      <td><span className={`fin-pill ${meta.cls}`}>{meta.label}</span></td>
                      <td className="text-muted">{a.dateEncaissement ? formatDate(a.dateEncaissement) : '—'}</td>
                      <td className="text-right">
                        <button type="button" className="fin-action" onClick={() => setEditing(a)}>
                          {a.statut === 'encaisse' ? 'Modifier' : 'Enregistrer'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {editing && (
          <RecordAcompteModal
            acompte={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); refetch() }}
          />
        )}
      </main>
    </AppShell>
  )
}

function RecordAcompteModal({
  acompte, onClose, onSaved,
}: { acompte: AcompteResponse; onClose: () => void; onSaved: () => void }) {
  const [statut, setStatut] = useState<AcompteStatut>(acompte.statut === 'attendu' ? 'encaisse' : acompte.statut)
  const [montantReel, setMontantReel] = useState(acompte.montantReel ?? acompte.acompteAmount ?? '')
  const [date, setDate] = useState(acompte.dateEncaissement ?? todayIso())
  const [notes, setNotes] = useState(acompte.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEncaisse = statut === 'encaisse'

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await recordAcompte(acompte.debriefId, {
        statut,
        montantReel: isEncaisse ? (montantReel || null) : null,
        dateEncaissement: isEncaisse ? (date || null) : null,
        notes: notes || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Enregistrer l'acompte" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Acompte</span>
            <h2>{acompte.clientName ?? 'Client'}</h2>
            <p className="fiche-modal-sub">
              Acompte attendu : {money(acompte.acompteAmount)}
              {(() => {
                const method = formatPaymentMethod(acompte.financingType, acompte.paymentSubMethod, acompte.financingOrg)
                return method ? ` · ${method}` : ''
              })()}
            </p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          <section className="wf-modal-section">
            <h3>Statut</h3>
            <select className="wf-modal-input" value={statut} onChange={(e) => setStatut(e.target.value as AcompteStatut)}>
              <option value="encaisse">Encaissé</option>
              <option value="attendu">Attendu</option>
              <option value="en_retard">En retard</option>
              <option value="annule">Annulé</option>
            </select>
          </section>

          {isEncaisse && (
            <>
              <section className="wf-modal-section">
                <h3>Montant réel encaissé</h3>
                <input className="wf-modal-input" inputMode="decimal" value={montantReel}
                  onChange={(e) => setMontantReel(e.target.value)} placeholder="ex : 3000" />
              </section>
              <section className="wf-modal-section">
                <h3>Date d'encaissement</h3>
                <input className="wf-modal-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </section>
            </>
          )}

          <section className="wf-modal-section">
            <h3>Notes</h3>
            <textarea className="wf-modal-input" rows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} placeholder="Référence virement, remarque…" />
          </section>

          {error && <p className="wf-modal-error">{error}</p>}
        </div>

        <footer className="wf-modal-foot">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </footer>
      </div>
    </div>
  )
}
