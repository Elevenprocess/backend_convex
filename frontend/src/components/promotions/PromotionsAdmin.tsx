// frontend/src/components/promotions/PromotionsAdmin.tsx
import { useState } from 'react'
import type { LeadResponse } from '../../lib/types'
import { formatPromotionRange, promotionLeads, promotionWebhookUrl } from '../../lib/promotions'
import {
  archivePromotion, attachLegacy, backfillPromotion, ensurePromotionWebhook, useLegacyPreview, usePromotionStats, usePromotionsList,
  type PromotionRow, type StatBlock,
} from '../../lib/promotionsApi'
import { PromotionForm, LEGACY_STATUS_OPTIONS } from './PromotionForm'
import { humanizeError } from '../../lib/hooks'
import { PromotionPie } from './PromotionPie'

const GROUPS: { key: PromotionRow['status']; label: string }[] = [
  { key: 'en_cours', label: 'En cours' },
  { key: 'a_venir', label: 'À venir' },
  { key: 'terminee', label: 'Terminées' },
]

export function PromotionsAdmin({ leads, onOpenLeads }: { leads: LeadResponse[]; onOpenLeads: (promo: PromotionRow) => void }) {
  const promos = usePromotionsList()
  const [editing, setEditing] = useState<PromotionRow | 'new' | null>(null)
  return (
    <div className="px-4 sm:px-8 py-4 space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-lg">Promotions</h2>
        <button type="button" onClick={() => setEditing('new')} className="btn-primary rounded-xl px-4 py-2 text-sm">Nouvelle promotion</button>
      </div>
      {promos === undefined && <p className="text-sm text-muted">Chargement…</p>}
      {promos && promos.length === 0 && <p className="text-sm text-muted">Aucune promotion pour l’instant.</p>}
      {promos && GROUPS.map((g) => {
        const rows = promos.filter((p) => p.status === g.key)
        if (rows.length === 0) return null
        return (
          <section key={g.key} className="space-y-2">
            <div className="text-[10px] font-bold tracking-widest uppercase text-faint">{g.label}</div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {rows.map((p) => (
                <PromotionCard key={p._id} promo={p} leadCount={promotionLeads(leads, p._id, 'all').length}
                  onEdit={() => setEditing(p)} onOpenLeads={() => onOpenLeads(p)} />
              ))}
            </div>
          </section>
        )
      })}
      {editing && (
        <PromotionForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      )}
    </div>
  )
}

/** Bouton « Copier le webhook » de la promo (lien à coller dans GHL). Crée le lien s'il manque. */
export function PromotionWebhookBox({ promo }: { promo: PromotionRow }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
  async function copy() {
    setBusy(true); setError(null)
    try {
      const key = promo.webhookKey ?? await ensurePromotionWebhook(promo._id)
      const url = promotionWebhookUrl(convexUrl, key)
      if (!url) throw new Error('Lien indisponible')
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        window.prompt('Copie ce lien dans GHL :', url)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(humanizeError(e, 'Lien webhook impossible'))
    } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={copy} disabled={busy}
        title="Dans le workflow GHL : action « Webhook », méthode POST, colle ce lien. Les contacts envoyés arrivent tout seuls dans la promo."
        className="btn-primary rounded-[10px] px-2.5 py-1 text-[11px]">
        {copied ? 'Webhook copié ✓' : busy ? 'Préparation…' : 'Copier le webhook'}
      </button>
      {error && <span className="text-[11px] text-rouille">{error}</span>}
    </span>
  )
}

function StatLine({ label, b }: { label: string; b: StatBlock }) {
  return (
    <div className="text-xs text-text">
      <span className="font-bold">{label}</span> : {b.leads} leads · {b.joints} joints · {b.rdvDomicile} RDV domicile · {b.rdvBureau} RDV bureau · {b.qualifies} qualifiés · {b.signes} signés
    </div>
  )
}

function PromotionCard({ promo, leadCount, onEdit, onOpenLeads }: { promo: PromotionRow; leadCount: number; onEdit: () => void; onOpenLeads: () => void }) {
  const stats = usePromotionStats(promo._id)
  const preview = useLegacyPreview(promo.status !== 'terminee' && promo.legacyStatuses?.length ? promo._id : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label); setMessage(null)
    try { setMessage(await fn()) } catch (e) { setMessage(humanizeError(e, 'Action impossible')) } finally { setBusy(null) }
  }
  const statusLabels = (promo.legacyStatuses ?? []).map((s) => LEGACY_STATUS_OPTIONS.find((o) => o.key === s)?.label ?? s).join(', ')

  return (
    <div className="rounded-[18px] border border-line bg-white/70 p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-bold text-text">{promo.name}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>
              {formatPromotionRange(promo.startAt, promo.endAt)}
              {statusLabels ? ` · anciens : ${statusLabels}` : ''}
              {promo.officeCalendarId ? ' · RDV bureau' : ''}
            </span>
            {promo.status !== 'terminee' && !promo.archived && <PromotionWebhookBox promo={promo} />}
          </div>
        </div>
        <button type="button" onClick={onOpenLeads} className="text-xs font-semibold text-or hover:underline">Voir les {leadCount} leads</button>
      </div>
      {stats && (
        <div className="space-y-2">
          <PromotionPie blocks={[stats.nouveaux, stats.anciens]} />
          <div className="space-y-0.5">
            <StatLine label="Nouveaux" b={stats.nouveaux} />
            <StatLine label="Anciens" b={stats.anciens} />
            {stats.rdvBureauHorsPromo > 0 && <div className="text-xs text-text">+ {stats.rdvBureauHorsPromo} RDV bureau pris par des leads hors promo</div>}
          </div>
        </div>
      )}
      {preview && (
        <div className="text-xs text-muted">Anciens leads à rattacher : <span className="font-bold text-text">{preview.eligible}</span>{preview.skipped ? ` (${preview.skipped} ignorés : RDV à venir, signés ou déjà dans une promo)` : ''}</div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onEdit} className="pill-tab text-xs bg-white border border-line">Modifier</button>
        {promo.status !== 'terminee' && (promo.legacyStatuses?.length ?? 0) > 0 && (
          <button type="button" disabled={busy !== null}
            onClick={() => run('legacy', async () => { const r = await attachLegacy(promo._id); return `${r.attached} lead(s) rattaché(s), ${r.skipped} ignoré(s).` })}
            className="pill-tab text-xs bg-white border border-line">{busy === 'legacy' ? 'Rattachement…' : 'Rattacher ces leads'}</button>
        )}
        {promo.tag && (
          <button type="button" disabled={busy !== null}
            onClick={() => run('backfill', async () => { const r = await backfillPromotion(promo._id); return `${r.attached} lead(s) rattrapé(s) sur ${r.scanned} webhooks relus.` })}
            className="pill-tab text-xs bg-white border border-line">{busy === 'backfill' ? 'Rattrapage…' : 'Rattraper les tags'}</button>
        )}
        {!promo.archived && (
          <button type="button" disabled={busy !== null}
            onClick={() => { if (window.confirm(`Archiver « ${promo.name} » ? Ses leads reviendront dans les onglets habituels.`)) void run('archive', async () => { await archivePromotion(promo._id); return 'Promotion archivée.' }) }}
            className="pill-tab text-xs bg-white border border-line text-rouille">Archiver</button>
        )}
      </div>
      {message && <div className="text-xs text-text">{message}</div>}
    </div>
  )
}
