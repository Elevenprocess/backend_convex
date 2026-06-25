import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useAcomptes } from '../lib/hooks'
import { updateFinancing, setEcheancier, resetEcheancier } from '../lib/api'
import { formatDate } from '../lib/suivi'
import { formatPaymentMethod } from '../lib/types'
import type { AcompteResponse, AcompteStatut, EcheanceLine, UpdateFinancingPatch, EcheancierTranchePatch } from '../lib/types'
import { RecordEcheanceModal } from '../components/finances/RecordEcheanceModal'

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
  const [editingFinancing, setEditingFinancing] = useState<AcompteResponse | null>(null)
  const [editingEcheancier, setEditingEcheancier] = useState<AcompteResponse | null>(null)

  const rows = useMemo(() => {
    const list = acomptes ?? []
    const q = query.trim().toLowerCase()
    return list.filter((a) => {
      if (filter !== 'tous' && !a.echeances.some((e) => e.statut === filter)) return false
      if (q && ![a.projectName, a.clientName].filter(Boolean).join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [acomptes, filter, query])

  const totals = useMemo(() => {
    const list = acomptes ?? []
    let aEncaisser = 0
    let encaisse = 0
    let aVenir = 0
    let nbRetard = 0
    let retardAmount = 0
    for (const a of list) {
      for (const e of a.echeances) {
        const prevu = Number(e.montantPrevu ?? 0) || 0
        if (e.statut === 'encaisse') encaisse += Number(e.montantReel ?? e.montantPrevu ?? 0) || 0
        else if (e.statut === 'a_encaisser') aEncaisser += prevu
        else if (e.statut === 'en_retard') { nbRetard += 1; aEncaisser += prevu; retardAmount += prevu }
        else if (e.statut === 'en_attente') aVenir += prevu
      }
    }
    return { aEncaisser, encaisse, aVenir, nbRetard, retardAmount }
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
            <p className="text-2xl font-black mt-1">{totals.retardAmount.toLocaleString('fr-FR')} €</p>
            <p className="text-xs text-faint mt-0.5">{totals.nbRetard} tranche{totals.nbRetard > 1 ? 's' : ''} en retard</p>
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
                  <th>Projet / Client</th>
                  <th>Commercial</th>
                  <th>Méthode de paiement</th>
                  <th>Montant total</th>
                  <th>Échéancier</th>
                  <th>À récupérer</th>
                  <th aria-label="actions" style={{ width: 40 }} />
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
                      onEditFinancing={() => setEditingFinancing(a)}
                      onEditEcheancier={() => setEditingEcheancier(a)}
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

        {editingFinancing && (
          <FinancingModal
            acompte={editingFinancing}
            onClose={() => setEditingFinancing(null)}
            onSaved={() => { setEditingFinancing(null); refetch() }}
          />
        )}

        {editingEcheancier && (
          <EcheancierEditorModal
            acompte={editingEcheancier}
            onClose={() => setEditingEcheancier(null)}
            onSaved={() => { setEditingEcheancier(null); refetch() }}
          />
        )}
      </main>
    </AppShell>
  )
}

function FinanceVenteRows({
  acompte: a, isOpen, onToggle, method, nbEncaisse, restant, onEdit, onEditFinancing, onEditEcheancier,
}: {
  acompte: AcompteResponse
  isOpen: boolean
  onToggle: () => void
  method: string | null
  nbEncaisse: number
  restant: number
  onEdit: (tranche: EcheanceLine) => void
  onEditFinancing: () => void
  onEditEcheancier: () => void
}) {
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle}>
        <td className="text-faint text-center">{isOpen ? '▾' : '▸'}</td>
        <td>
          <span className="font-semibold text-text">{a.projectName ?? a.clientName ?? '—'}</span>
          {a.projectName && a.clientName && <span className="block text-xs text-faint">{a.clientName}</span>}
        </td>
        <td className="text-muted">{a.commercialName ?? '—'}</td>
        <td className="text-muted">
          {method ?? '—'}
          {a.edfRecepisse && <span className="ml-1.5 fin-pill bg-or-tint text-or-dark">Récépissé EDF</span>}
        </td>
        <td>{money(a.montantTotal)}</td>
        <td className="text-muted">{nbEncaisse}/{a.echeances.length} encaissée{a.echeances.length > 1 ? 's' : ''}</td>
        <td className="font-semibold">{restant > 0 ? `${restant.toLocaleString('fr-FR')} €` : '—'}</td>
        <td className="text-right whitespace-nowrap">
          <button type="button" className="fin-action" title="Modifier les données financières" onClick={(ev) => { ev.stopPropagation(); onEditFinancing() }}>
            ✎
          </button>
          <button type="button" className="fin-action ml-1" title="Personnaliser l'échéancier (tranches)" onClick={(ev) => { ev.stopPropagation(); onEditEcheancier() }}>
            ⛃{a.customEcheancier ? '*' : ''}
          </button>
        </td>
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
              {e.dateEncaissement
                ? <span className="text-faint text-xs ml-2">{formatDate(e.dateEncaissement)}</span>
                : e.dateEcheance && <span className="text-faint text-xs ml-2">échéance {formatDate(e.dateEcheance)}</span>}
            </td>
            <td className="text-right" colSpan={2}>
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

const FINANCING_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'financement', label: 'Financement' },
  { value: 'comptant', label: 'Au comptant' },
  { value: 'paiement_10x', label: 'Paiement x10' },
  { value: 'paiement_12x', label: 'Paiement x12' },
]

/**
 * Édition par le back-office finances des données financières d'une vente :
 * montant du devis, type de paiement, organisme et acompte. Patch par diff
 * (seuls les champs modifiés sont envoyés). L'échéancier se recalcule ensuite.
 */
function FinancingModal({
  acompte: a, onClose, onSaved,
}: { acompte: AcompteResponse; onClose: () => void; onSaved: () => void }) {
  const [montantTotal, setMontantTotal] = useState(a.montantTotal ?? '')
  const [financingType, setFinancingType] = useState(a.financingType ?? '')
  const [paymentSubMethod, setPaymentSubMethod] = useState(a.paymentSubMethod ?? '')
  const [financingOrg, setFinancingOrg] = useState(a.financingOrg ?? '')
  const [acomptePercent, setAcomptePercent] = useState(a.acomptePercent != null ? String(a.acomptePercent) : '')
  const [acompteAmount, setAcompteAmount] = useState(a.acompteAmount ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const patch: UpdateFinancingPatch = {}
      const t = (v: string) => v.trim()
      if (t(montantTotal) !== (a.montantTotal ?? '')) patch.montantTotal = t(montantTotal) || null
      if (t(financingType) !== (a.financingType ?? '')) patch.financingType = t(financingType) || null
      if (t(paymentSubMethod) !== (a.paymentSubMethod ?? '')) patch.paymentSubMethod = t(paymentSubMethod) || null
      if (t(financingOrg) !== (a.financingOrg ?? '')) patch.financingOrg = t(financingOrg) || null
      const pctInit = a.acomptePercent != null ? String(a.acomptePercent) : ''
      if (t(acomptePercent) !== pctInit) patch.acomptePercent = t(acomptePercent) ? Number(t(acomptePercent)) : null
      if (t(acompteAmount) !== (a.acompteAmount ?? '')) patch.acompteAmount = t(acompteAmount) || null
      if (Object.keys(patch).length === 0) { onClose(); return }
      await updateFinancing(a.debriefId, patch)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Modifier les finances" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Finances · données de la vente</span>
            <h2>{a.projectName ?? a.clientName ?? 'Projet'}</h2>
            <p className="fiche-modal-sub">Modifiable par le back-office — l'échéancier se recalcule.</p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          <section className="wf-modal-section">
            <h3>Montant du devis (€)</h3>
            <input className="wf-modal-input" inputMode="decimal" value={montantTotal}
              onChange={(e) => setMontantTotal(e.target.value)} placeholder="ex : 15000" />
          </section>
          <section className="wf-modal-section">
            <h3>Type de paiement</h3>
            <select className="wf-modal-input" value={financingType} onChange={(e) => setFinancingType(e.target.value)}>
              <option value="">— Non renseigné —</option>
              {FINANCING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </section>
          <section className="wf-modal-section">
            <h3>Méthode (comptant)</h3>
            <select className="wf-modal-input" value={paymentSubMethod} onChange={(e) => setPaymentSubMethod(e.target.value)}>
              <option value="">—</option>
              <option value="cheque">Chèque</option>
              <option value="especes">Espèces</option>
              <option value="virement">Virement</option>
            </select>
          </section>
          <section className="wf-modal-section">
            <h3>Organisme de financement</h3>
            <input className="wf-modal-input" value={financingOrg}
              onChange={(e) => setFinancingOrg(e.target.value)} placeholder="ex : cmoi, sofider" />
          </section>
          <section className="wf-modal-section">
            <h3>Acompte — pourcentage (%)</h3>
            <input className="wf-modal-input" inputMode="numeric" value={acomptePercent}
              onChange={(e) => setAcomptePercent(e.target.value)} placeholder="ex : 40" />
          </section>
          <section className="wf-modal-section">
            <h3>Acompte — montant (€)</h3>
            <input className="wf-modal-input" inputMode="decimal" value={acompteAmount}
              onChange={(e) => setAcompteAmount(e.target.value)} placeholder="ex : 6000" />
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

type EditTranche = { label: string; percent: string; dateEcheance: string; jalonKey: string | null }

/**
 * Éditeur d'échéancier personnalisé : le back-office définit librement le nombre
 * de tranches, leur libellé, leur % et leur date d'échéance. Préremplit depuis
 * l'échéancier courant. Affiche le total des % et le reste à répartir.
 */
function EcheancierEditorModal({
  acompte: a, onClose, onSaved,
}: { acompte: AcompteResponse; onClose: () => void; onSaved: () => void }) {
  const [tranches, setTranches] = useState<EditTranche[]>(() =>
    a.echeances.map((e) => ({
      label: e.label ?? '',
      percent: e.percent != null ? String(e.percent) : '',
      dateEcheance: e.dateEcheance ?? '',
      jalonKey: e.jalonKey,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = Number(a.montantTotal ?? 0) || 0
  const sumPercent = tranches.reduce((s, t) => s + (Number(t.percent) || 0), 0)
  const reste = 100 - sumPercent

  const setRow = (i: number, patch: Partial<EditTranche>) =>
    setTranches((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () => setTranches((rows) => [...rows, { label: '', percent: '', dateEcheance: '', jalonKey: null }])
  const removeRow = (i: number) => setTranches((rows) => rows.filter((_, idx) => idx !== i))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: EcheancierTranchePatch[] = tranches.map((t) => ({
        label: t.label.trim() || null,
        percent: t.percent.trim() ? Number(t.percent) : null,
        montantPrevu: null,
        jalonKey: t.jalonKey,
        dateEcheance: t.dateEcheance || null,
      }))
      await setEcheancier(a.debriefId, payload)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  const revert = async () => {
    if (!window.confirm("Revenir à l'échéancier standard ? Les tranches personnalisées seront ignorées.")) return
    setSaving(true)
    setError(null)
    try {
      await resetEcheancier(a.debriefId)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fiche-modal-backdrop" role="dialog" aria-modal="true" aria-label="Personnaliser l'échéancier" onClick={onClose}>
      <div className="fiche-modal wf-modal" onClick={(e) => e.stopPropagation()}>
        <header className="fiche-modal-head">
          <div className="min-w-0">
            <span className="eyebrow text-or-dark">Échéancier personnalisé</span>
            <h2>{a.projectName ?? a.clientName ?? 'Projet'}</h2>
            <p className="fiche-modal-sub">
              Montant total {money(a.montantTotal)} · total réparti {sumPercent}%
              {reste !== 0 && <span className={reste < 0 ? 'text-rouille' : 'text-faint'}> · reste {reste}%</span>}
            </p>
          </div>
          <button type="button" className="fiche-modal-close" onClick={onClose} aria-label="Fermer">✕</button>
        </header>

        <div className="fiche-modal-body">
          {tranches.map((t, i) => (
            <div key={i} className="flex items-end gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">Libellé</label>
                <input className="wf-modal-input" value={t.label} placeholder={`Tranche ${i + 1}`}
                  onChange={(e) => setRow(i, { label: e.target.value })} />
              </div>
              <div style={{ width: 72 }}>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">%</label>
                <input className="wf-modal-input" inputMode="numeric" value={t.percent}
                  onChange={(e) => setRow(i, { percent: e.target.value })} />
              </div>
              <div style={{ width: 96 }}>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">Montant</label>
                <div className="text-sm font-semibold pt-2">{total && Number(t.percent) ? `${Math.round(total * Number(t.percent) / 100).toLocaleString('fr-FR')} €` : '—'}</div>
              </div>
              <div style={{ width: 150 }}>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-faint">Échéance</label>
                <input className="wf-modal-input" type="date" value={t.dateEcheance}
                  onChange={(e) => setRow(i, { dateEcheance: e.target.value })} />
              </div>
              <button type="button" className="fin-action text-rouille mb-1" title="Supprimer la tranche"
                onClick={() => removeRow(i)} disabled={tranches.length <= 1}>✕</button>
            </div>
          ))}

          <button type="button" className="fin-action mt-1" onClick={addRow}>+ Ajouter une tranche</button>

          {sumPercent !== 100 && (
            <p className="text-xs text-rouille mt-3">⚠ Le total des pourcentages est de {sumPercent}% (attendu : 100%).</p>
          )}
          {error && <p className="wf-modal-error mt-2">{error}</p>}
        </div>

        <footer className="wf-modal-foot">
          {a.customEcheancier && (
            <button type="button" className="btn-ghost mr-auto" onClick={() => void revert()} disabled={saving}>
              Revenir au standard
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer l’échéancier'}
          </button>
        </footer>
      </div>
    </div>
  )
}
