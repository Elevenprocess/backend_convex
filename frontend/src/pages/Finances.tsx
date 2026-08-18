import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/shell/AppShell'
import { Topbar } from '../components/shell/Topbar'
import { LoadingBlock } from '../components/Spinner'
import { useAuth } from '../lib/auth'
import { useAcomptes } from '../lib/hooks'
import { updateFinancing } from '../lib/api'
import { formatDate } from '../lib/suivi'
import { formatPaymentMethod } from '../lib/types'
import type { AcompteResponse, AcompteStatut, EcheanceLine, UpdateFinancingPatch } from '../lib/types'
import { RecordEcheanceModal } from '../components/finances/RecordEcheanceModal'
import { EcheancierEditorModal } from '../components/finances/EcheancierEditorModal'
import { filterAcomptesByEncaissementDate } from '../lib/financesFilters'
import { buildEncaissementSeries } from '../lib/financesCharts'
import { FinancesCharts } from '../components/finances/FinancesCharts'
import { DateRangePicker } from '../components/analytics/DateRangePicker'
import { CountUp } from '../components/delivery/CountUp'
import { Icon } from '../components/Icon'
import { buildPeriodRange, defaultPeriod, toDateInputValue, type PeriodState } from '../lib/period'

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
  const canAccessFinances = role === 'admin' || role === 'finances' || role === 'delivrabilite' || role === 'responsable_technique' || role === 'back_office'
  const { data: acomptes, loading, refetch } = useAcomptes(canAccessFinances)
  const [filter, setFilter] = useState<'tous' | AcompteStatut>('tous')
  const [query, setQuery] = useState('')
  // Période (même sélecteur que la vue d'ensemble) : borne les ENCAISSEMENTS
  // (KPI « Encaissé », courbe, liste filtrée « Encaissées »). Le reste à
  // encaisser / à venir n'est jamais masqué par la période.
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod('this_year'))
  const range = useMemo(() => buildPeriodRange(period), [period])
  const dateFrom = toDateInputValue(new Date(range.from))
  const dateTo = toDateInputValue(new Date(range.to))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ acompte: AcompteResponse; tranche: EcheanceLine } | null>(null)
  const [editingFinancing, setEditingFinancing] = useState<AcompteResponse | null>(null)
  const [editingEcheancier, setEditingEcheancier] = useState<AcompteResponse | null>(null)

  const rows = useMemo(() => {
    const list = acomptes ?? []
    const q = query.trim().toLowerCase()
    const scoped = filter === 'encaisse'
      ? filterAcomptesByEncaissementDate(list, dateFrom || null, dateTo || null)
      : list
    return scoped.filter((a) => {
      if (filter !== 'tous' && !a.echeances.some((e) => e.statut === filter)) return false
      if (q && ![a.projectName, a.clientName, a.commercialName].filter(Boolean).join(' ').toLowerCase().includes(q)) return false
      return true
    })
  }, [acomptes, filter, query, dateFrom, dateTo])

  const totals = useMemo(() => {
    const list = acomptes ?? []
    let aEncaisser = 0
    let encaisse = 0
    let encaisseTotal = 0
    let aVenir = 0
    let nbRetard = 0
    let retardAmount = 0
    let nbAEncaisser = 0
    for (const a of list) {
      for (const e of a.echeances) {
        const prevu = Number(e.montantPrevu ?? 0) || 0
        if (e.statut === 'encaisse') {
          const d = e.dateEncaissement
          const reel = Number(e.montantReel ?? e.montantPrevu ?? 0) || 0
          encaisseTotal += reel
          const inDateRange = (!dateFrom || (d != null && d >= dateFrom)) && (!dateTo || (d != null && d <= dateTo))
          if (inDateRange) encaisse += reel
        }
        else if (e.statut === 'a_encaisser') { aEncaisser += prevu; nbAEncaisser += 1 }
        else if (e.statut === 'en_retard') { nbRetard += 1; aEncaisser += prevu; retardAmount += prevu }
        else if (e.statut === 'en_attente') aVenir += prevu
      }
    }
    const pipeline = encaisseTotal + aEncaisser + aVenir
    const pctEncaisse = pipeline > 0 ? Math.round((encaisseTotal / pipeline) * 100) : 0
    return { aEncaisser, encaisse, encaisseTotal, aVenir, nbRetard, retardAmount, nbAEncaisser, pipeline, pctEncaisse }
  }, [acomptes, dateFrom, dateTo])

  const chartSeries = useMemo(
    () => buildEncaissementSeries(acomptes ?? [], dateFrom || null, dateTo || null),
    [acomptes, dateFrom, dateTo],
  )

  const statusCounts = useMemo(() => {
    const list = acomptes ?? []
    const counts: Record<string, number> = { tous: list.length }
    for (const f of FILTERS) {
      if (f.key === 'tous') continue
      counts[f.key] = list.filter((a) => a.echeances.some((e) => e.statut === f.key)).length
    }
    return counts
  }, [acomptes])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (role && !canAccessFinances) return <Navigate to="/overview" replace />

  const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`
  const split = [
    { key: 'encaisse', label: 'Encaissé', value: totals.encaisseTotal, color: 'var(--color-or)' },
    { key: 'a_encaisser', label: 'À encaisser', value: totals.aEncaisser - totals.retardAmount, color: 'var(--color-cuivre)' },
    { key: 'en_retard', label: 'En retard', value: totals.retardAmount, color: 'var(--color-rouille)' },
    { key: 'a_venir', label: 'À venir', value: totals.aVenir, color: 'var(--color-line)' },
  ]

  return (
    <AppShell flat>
      <Topbar eyebrow="FINANCES" title="Suivi des acomptes" />
      <main className="suivi-page fin-page flex-grow overflow-y-auto px-4 sm:px-8 pt-4 pb-10">
        <header className="fin-hero">
          <div>
            <span className="fin-eyebrow">Finances</span>
            <h1>Suivi des acomptes</h1>
            <p>Encaissements, tranches dues et échéanciers des ventes signées.</p>
          </div>
          <div className="fin-hero-actions">
            <DateRangePicker value={period} onChange={setPeriod} align="right" />
          </div>
        </header>

        {/* KPI — bento : hero « encaissé » + 3 compteurs */}
        <section className="fin-kpis" aria-label="Indicateurs">
          <article className="fin-kpi fin-kpi--hero">
            <div className="fin-kpi-top">
              <span className="fin-kpi-icon fin-kpi-icon--or"><Icon name="check" size={16} /></span>
              <span className="fin-kpi-label">Encaissé · {range.label}</span>
            </div>
            <CountUp className="fin-kpi-value" value={Math.round(totals.encaisse)} format={fmt} />
            <div className="fin-kpi-progress" aria-label={`${totals.pctEncaisse}% du total encaissé`}>
              <div className="fin-kpi-track"><div className="fin-kpi-fill" style={{ width: `${totals.pctEncaisse}%` }} /></div>
              <span>{totals.pctEncaisse}% du total · {fmt(totals.encaisseTotal)} encaissés sur {fmt(totals.pipeline)}</span>
            </div>
          </article>
          <button type="button" className={`fin-kpi ${filter === 'a_encaisser' ? 'is-active' : ''}`} onClick={() => setFilter(filter === 'a_encaisser' ? 'tous' : 'a_encaisser')}>
            <div className="fin-kpi-top">
              <span className="fin-kpi-icon fin-kpi-icon--cuivre"><Icon name="clock" size={16} /></span>
              <span className="fin-kpi-label">À encaisser</span>
            </div>
            <CountUp className="fin-kpi-value" value={Math.round(totals.aEncaisser)} format={fmt} />
            <span className="fin-kpi-sub">{totals.nbAEncaisser + totals.nbRetard} tranche{totals.nbAEncaisser + totals.nbRetard > 1 ? 's' : ''} · jalon franchi</span>
          </button>
          <button type="button" className={`fin-kpi ${filter === 'en_retard' ? 'is-active' : ''} ${totals.nbRetard > 0 ? 'fin-kpi--alert' : ''}`} onClick={() => setFilter(filter === 'en_retard' ? 'tous' : 'en_retard')}>
            <div className="fin-kpi-top">
              <span className="fin-kpi-icon fin-kpi-icon--rouille"><Icon name="bell" size={16} /></span>
              <span className="fin-kpi-label">En retard</span>
            </div>
            <CountUp className="fin-kpi-value" value={Math.round(totals.retardAmount)} format={fmt} />
            <span className="fin-kpi-sub">{totals.nbRetard} tranche{totals.nbRetard > 1 ? 's' : ''} en retard</span>
          </button>
          <button type="button" className={`fin-kpi ${filter === 'en_attente' ? 'is-active' : ''}`} onClick={() => setFilter(filter === 'en_attente' ? 'tous' : 'en_attente')}>
            <div className="fin-kpi-top">
              <span className="fin-kpi-icon"><Icon name="calendar" size={16} /></span>
              <span className="fin-kpi-label">À venir</span>
            </div>
            <CountUp className="fin-kpi-value" value={Math.round(totals.aVenir)} format={fmt} />
            <span className="fin-kpi-sub">jalon pas encore atteint</span>
          </button>
        </section>

        <section className="fin-insights">
          <FinancesCharts data={chartSeries} subtitle={range.label} />
          <div className="fin-card fin-split">
            <div className="fin-card-head">
              <div>
                <span className="fin-eyebrow">Répartition</span>
                <h3>Où en est le chiffre signé</h3>
                <p>{fmt(totals.pipeline)} au total</p>
              </div>
            </div>
            <div className="fin-split-bar" aria-hidden>
              {split.filter((s) => s.value > 0).map((s) => (
                <span key={s.key} style={{ width: `${totals.pipeline > 0 ? (s.value / totals.pipeline) * 100 : 0}%`, background: s.color }} />
              ))}
            </div>
            <ul className="fin-split-list">
              {split.map((s) => (
                <li key={s.key}>
                  <i style={{ background: s.color }} />
                  <span>{s.label}</span>
                  <b>{fmt(s.value)}</b>
                  <small>{totals.pipeline > 0 ? Math.round((s.value / totals.pipeline) * 100) : 0}%</small>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="fin-card fin-list">
          <div className="fin-list-head">
            <div className="fin-list-title">
              <h3>Ventes</h3>
              <span className="fin-count">{rows.length}</span>
            </div>
            <div className="fin-filters" role="tablist" aria-label="Filtrer par statut">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
                  {f.label}<span>{statusCounts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>
            <label className="fin-search">
              <Icon name="search" size={14} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client, projet, commercial…" aria-label="Rechercher une vente" />
            </label>
          </div>

          {loading ? (
            <LoadingBlock label="Chargement des acomptes…" />
          ) : rows.length === 0 ? (
            <div className="fin-empty">
              Aucune vente {filter !== 'tous' ? `« ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} »` : 'à suivre'}{filter === 'encaisse' ? ` sur ${range.label.toLowerCase()}` : ''}.
              {(filter !== 'tous' || query) && <button type="button" onClick={() => { setFilter('tous'); setQuery('') }}>Réinitialiser</button>}
            </div>
          ) : (
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th aria-label="déplier" style={{ width: 36 }} />
                    <th>Projet / Client</th>
                    <th>Commercial</th>
                    <th>Paiement</th>
                    <th className="is-num">Montant</th>
                    <th>Échéancier</th>
                    <th className="is-num">À récupérer</th>
                    <th aria-label="actions" style={{ width: 84 }} />
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
        </section>

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
  const hasEnRetard = a.echeances.some((e) => e.statut === 'en_retard')
  const hasAEncaisser = a.echeances.some((e) => e.statut === 'a_encaisser')
  const alerteEncaissement = hasEnRetard || hasAEncaisser

  const initials = (a.clientName ?? a.projectName ?? '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const total = a.echeances.length || 1
  const pctDone = Math.round((nbEncaisse / total) * 100)

  return (
    <>
      <tr className={`fin-row ${isOpen ? 'is-open' : ''} ${hasEnRetard ? 'fin-row--retard' : hasAEncaisser ? 'fin-row--due' : ''}`} onClick={onToggle}>
        <td className="fin-toggle-cell"><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} /></td>
        <td data-label="Projet / Client">
          <div className="fin-client">
            <span className="fin-avatar" aria-hidden>{initials}</span>
            <div>
              <span className="fin-client-name">{a.projectName ?? a.clientName ?? '—'}</span>
              {a.projectName && a.clientName && <span className="fin-client-sub">{a.clientName}</span>}
              {alerteEncaissement && (
                <span className={`fin-pill ${hasEnRetard ? 'bg-rouille-tint text-rouille' : 'bg-cuivre-tint text-cuivre'}`}>
                  {hasEnRetard ? 'En retard' : 'À encaisser'}
                </span>
              )}
            </div>
          </div>
        </td>
        <td data-label="Commercial" className="text-muted">{a.commercialName ?? '—'}</td>
        <td data-label="Paiement" className="text-muted">
          <span>{method ?? '—'}</span>
          {a.echeancierSource === 'devis' && (
            <span className="fin-pill bg-or-tint text-or-dark ml-1.5" title="Échéancier issu des conditions de règlement du devis signé">
              Devis{a.devisNumber ? ` ${a.devisNumber}` : ''}
            </span>
          )}
          {a.edfRecepisse && <span className="fin-pill bg-or-tint text-or-dark ml-1.5">Récépissé EDF</span>}
        </td>
        <td data-label="Montant" className="is-num">{money(a.montantTotal)}</td>
        <td data-label="Échéancier">
          <div className="fin-ech" title={`${nbEncaisse}/${a.echeances.length} tranche${a.echeances.length > 1 ? 's' : ''} encaissée${nbEncaisse > 1 ? 's' : ''}`}>
            <div className="fin-ech-track"><div className="fin-ech-fill" style={{ width: `${pctDone}%` }} /></div>
            <span>{nbEncaisse}/{a.echeances.length}</span>
          </div>
        </td>
        <td data-label="À récupérer" className={`is-num ${restant > 0 ? 'fin-strong' : 'text-faint'}`}>{restant > 0 ? `${restant.toLocaleString('fr-FR')} €` : '—'}</td>
        <td className="fin-actions-cell">
          <button type="button" className="fin-icon-btn" title="Modifier les données financières" aria-label="Modifier les données financières" onClick={(ev) => { ev.stopPropagation(); onEditFinancing() }}>
            <Icon name="edit" size={14} />
          </button>
          <button type="button" className={`fin-icon-btn ${a.customEcheancier ? 'is-custom' : ''}`} title={`Personnaliser l'échéancier${a.customEcheancier ? ' (personnalisé)' : ''}`} aria-label="Personnaliser l'échéancier" onClick={(ev) => { ev.stopPropagation(); onEditEcheancier() }}>
            <Icon name="grid" size={14} />
          </button>
        </td>
      </tr>
      {isOpen && a.echeances.map((e, idx) => {
        const meta = STATUT_META[e.statut]
        const isLast = idx === a.echeances.length - 1
        return (
          <tr key={e.ordre} className="fin-sub">
            <td className="fin-toggle-cell">
              <span className={`fin-step ${isLast ? 'is-last' : ''}`}><i className={`fin-step-dot fin-step-dot--${e.statut}`} /></span>
            </td>
            <td data-label="Tranche" colSpan={2}>
              <span className="fin-strong">Tranche {e.ordre}</span>
              <span className="text-faint"> · {e.label}</span>
              {e.percent != null && <span className="text-faint text-xs"> ({e.percent}%)</span>}
            </td>
            <td data-label="Jalon" className="text-xs">
              {e.jalonKey
                ? e.jalonAtteint
                  ? <span className="text-or-dark font-semibold">Jalon franchi</span>
                  : <span className="text-faint">Jalon en attente</span>
                : <span className="text-faint">—</span>}
            </td>
            <td data-label="Montant" className="is-num fin-strong">{money(e.statut === 'encaisse' ? (e.montantReel ?? e.montantPrevu) : e.montantPrevu)}</td>
            <td data-label="Statut">
              <span className={`fin-pill ${meta.cls}`}>{meta.label}</span>
              {e.dateEncaissement
                ? <span className="text-faint text-xs ml-2">{formatDate(e.dateEncaissement)}</span>
                : e.dateEcheance && <span className="text-faint text-xs ml-2">échéance {formatDate(e.dateEcheance)}</span>}
            </td>
            <td className="fin-actions-cell" colSpan={2}>
              <button type="button" className={`fin-action ${e.statut !== 'encaisse' && e.statut !== 'annule' ? 'is-primary' : ''}`} onClick={(ev) => { ev.stopPropagation(); onEdit(e) }}>
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

