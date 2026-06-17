import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useAcomptes } from '../lib/hooks'
import { recordEcheance } from '../lib/api'
import { todayIso } from '../lib/suivi-board'
import { formatDate } from '../lib/suivi'
import { formatPaymentMethod } from '../lib/types'
import type { AcompteResponse, AcompteStatut, EcheanceLine } from '../lib/types'

const STATUT_META: Record<AcompteStatut, { label: string; cls: string }> = {
  en_attente: { label: 'En attente', cls: 'bg-line text-faint' },
  a_encaisser: { label: 'À encaisser', cls: 'bg-cuivre-tint text-cuivre' },
  encaisse: { label: 'Encaissé', cls: 'bg-or-tint text-or-dark' },
  en_retard: { label: 'En retard', cls: 'bg-rouille-tint text-rouille' },
  annule: { label: 'Annulé', cls: 'bg-line text-faint' },
}

const FILTERS: Array<{ key: 'tous' | AcompteStatut; label: string }> = [
  { key: 'tous', label: 'Toutes' },
  { key: 'a_encaisser', label: 'À encaisser' },
  { key: 'en_attente', label: 'En attente' },
  { key: 'encaisse', label: 'Encaissées' },
  { key: 'en_retard', label: 'En retard' },
  { key: 'annule', label: 'Annulées' },
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ acompte: AcompteResponse; tranche: EcheanceLine } | null>(null)

  const rows = useMemo(() => {
    const list = acomptes ?? []
    const q = query.trim().toLowerCase()
    return list.filter((a) => {
      if (filter !== 'tous' && !a.echeances.some((e) => e.statut === filter)) return false
      if (q && !(a.clientName ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [acomptes, filter, query])

  const totals = useMemo(() => {
    const list = acomptes ?? []
    let aEncaisser = 0
    let encaisse = 0
    let aVenir = 0
    let nbRetard = 0
    for (const a of list) {
      for (const e of a.echeances) {
        const prevu = Number(e.montantPrevu ?? 0) || 0
        if (e.statut === 'encaisse') encaisse += Number(e.montantReel ?? e.montantPrevu ?? 0) || 0
        else if (e.statut === 'a_encaisser') aEncaisser += prevu
        else if (e.statut === 'en_retard') { nbRetard += 1; aEncaisser += prevu }
        else if (e.statut === 'en_attente') aVenir += prevu
      }
    }
    return { aEncaisser, encaisse, aVenir, nbRetard }
  }, [acomptes])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (role && role !== 'admin' && role !== 'finances') return <Navigate to="/overview" replace />

  return (
    <AppShell flat>
      <Topbar eyebrow="FINANCES" title="Suivi des acomptes" />
      <main className="suivi-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
          <div className="glass-card p-4">
            <span className="eyebrow text-or-dark">À encaisser</span>
            <p className="text-2xl font-black mt-1">{totals.aEncaisser.toLocaleString('fr-FR')} €</p>
            <p className="text-xs text-faint mt-0.5">jalon franchi, en attente d'encaissement</p>
          </div>
          <div className="glass-card p-4">
            <span className="eyebrow text-or-dark">Encaissé</span>
            <p className="text-2xl font-black mt-1">{totals.encaisse.toLocaleString('fr-FR')} €</p>
          </div>
          <div className="glass-card p-4">
            <span className="eyebrow text-or-dark">À venir</span>
            <p className="text-2xl font-black mt-1">{totals.aVenir.toLocaleString('fr-FR')} €</p>
            <p className="text-xs text-faint mt-0.5">tranches dont le jalon n'est pas atteint</p>
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
            Aucune vente {filter !== 'tous' ? `« ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} »` : 'à suivre'}.
          </div>
        ) : (
          <div className="fin-table-wrap glass-card overflow-hidden">
            <table className="fin-table">
              <thead>
                <tr>
                  <th aria-label="déplier" style={{ width: 32 }} />
                  <th>Client</th>
                  <th>Commercial</th>
                  <th>Méthode de paiement</th>
                  <th>Montant total</th>
                  <th>Échéancier</th>
                  <th>À récupérer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const isOpen = expanded.has(a.debriefId)
                  const nbEncaisse = a.echeances.filter((e) => e.statut === 'encaisse').length
                  const restant = a.echeances
                    .filter((e) => e.statut !== 'encaisse' && e.statut !== 'annule')
                    .reduce((s, e) => s + (Number(e.montantPrevu ?? 0) || 0), 0)
                  const method = formatPaymentMethod(a.financingType, a.paymentSubMethod, a.financingOrg)
                  return (
                    <FinanceVenteRows
                      key={a.debriefId}
                      acompte={a}
                      isOpen={isOpen}
                      onToggle={() => toggle(a.debriefId)}
                      method={method}
                      nbEncaisse={nbEncaisse}
                      restant={restant}
                      onEdit={(tranche) => setEditing({ acompte: a, tranche })}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {editing && (
          <RecordEcheanceModal
            acompte={editing.acompte}
            tranche={editing.tranche}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); refetch() }}
          />
        )}
      </main>
    </AppShell>
  )
}

function FinanceVenteRows({
  acompte: a, isOpen, onToggle, method, nbEncaisse, restant, onEdit,
}: {
  acompte: AcompteResponse
  isOpen: boolean
  onToggle: () => void
  method: string | null
  nbEncaisse: number
  restant: number
  onEdit: (tranche: EcheanceLine) => void
}) {
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle}>
        <td className="text-faint text-center">{isOpen ? '▾' : '▸'}</td>
        <td className="font-semibold text-text">{a.clientName ?? '—'}</td>
        <td className="text-muted">{a.commercialName ?? '—'}</td>
        <td className="text-muted">
          {method ?? '—'}
          {a.edfRecepisse && <span className="ml-1.5 fin-pill bg-or-tint text-or-dark">Récépissé EDF</span>}
        </td>
        <td>{money(a.montantTotal)}</td>
        <td className="text-muted">{nbEncaisse}/{a.echeances.length} encaissée{a.echeances.length > 1 ? 's' : ''}</td>
        <td className="font-semibold">{restant > 0 ? `${restant.toLocaleString('fr-FR')} €` : '—'}</td>
      </tr>
      {isOpen && a.echeances.map((e) => {
        const meta = STATUT_META[e.statut]
        return (
          <tr key={e.ordre} className="bg-cream-darker/40">
            <td />
            <td colSpan={2} className="pl-2">
              <span className="font-semibold text-text">Tranche {e.ordre}</span>
              <span className="text-faint"> · {e.label}</span>
              {e.percent != null && <span className="text-faint text-xs"> ({e.percent}%)</span>}
            </td>
            <td className="text-xs">
              {e.jalonKey
                ? e.jalonAtteint
                  ? <span className="text-or-dark font-semibold">✓ jalon franchi</span>
                  : <span className="text-faint">jalon en attente</span>
                : <span className="text-faint">—</span>}
            </td>
            <td className="font-semibold">{money(e.statut === 'encaisse' ? (e.montantReel ?? e.montantPrevu) : e.montantPrevu)}</td>
            <td>
              <span className={`fin-pill ${meta.cls}`}>{meta.label}</span>
              {e.dateEncaissement && <span className="text-faint text-xs ml-2">{formatDate(e.dateEncaissement)}</span>}
            </td>
            <td className="text-right">
              <button type="button" className="fin-action" onClick={(ev) => { ev.stopPropagation(); onEdit(e) }}>
                {e.statut === 'encaisse' ? 'Modifier' : 'Enregistrer'}
              </button>
            </td>
          </tr>
        )
      })}
    </>
  )
}

function RecordEcheanceModal({
  acompte, tranche, onClose, onSaved,
}: { acompte: AcompteResponse; tranche: EcheanceLine; onClose: () => void; onSaved: () => void }) {
  const [statut, setStatut] = useState<AcompteStatut>(
    tranche.statut === 'encaisse' || tranche.statut === 'annule' ? tranche.statut : 'encaisse',
  )
  const [montantReel, setMontantReel] = useState(tranche.montantReel ?? tranche.montantPrevu ?? '')
  const [date, setDate] = useState(tranche.dateEncaissement ?? todayIso())
  const [notes, setNotes] = useState(tranche.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEncaisse = statut === 'encaisse'

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await recordEcheance(acompte.debriefId, {
        ordre: tranche.ordre,
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
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Enregistrer la tranche" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Acompte · tranche {tranche.ordre}</span>
            <h2>{acompte.clientName ?? 'Client'}</h2>
            <p className="fiche-modal-sub">
              {tranche.label}
              {tranche.percent != null ? ` · ${tranche.percent}%` : ''} · prévu {money(tranche.montantPrevu)}
            </p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          <section className="wf-modal-section">
            <h3>Statut</h3>
            <select className="wf-modal-input" value={statut} onChange={(e) => setStatut(e.target.value as AcompteStatut)}>
              <option value="encaisse">Encaissé</option>
              <option value="a_encaisser">À encaisser</option>
              <option value="en_attente">En attente</option>
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
