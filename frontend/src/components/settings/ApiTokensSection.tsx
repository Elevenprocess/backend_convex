import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Icon } from '../Icon'
import { LoadingBlock } from '../Spinner'
import {
  apiTokensCreate, apiTokensList, apiTokensRevoke, apiTokensUpdateScopes,
  type ConvexApiToken,
} from '../../lib/convexApi'
import { API_DOMAINS, compactScopes, expandToSet, scopeGranted, summarizeScopes } from '../../lib/apiScopes'
import { copyText } from '../../lib/hooks'
import { notifyClipboardCopied } from '../../lib/clipboardToast'
import { convexClient } from '../../lib/convex'

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtDateTime = (ms: number) => new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const EXPIRATIONS: Array<{ label: string; days: number | null }> = [
  { label: 'Jamais', days: null },
  { label: '30 jours', days: 30 },
  { label: '90 jours', days: 90 },
  { label: '1 an', days: 365 },
]

export function apiBaseUrl(): string {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined
  return url ? `${url.replace('.convex.cloud', '.convex.site')}/api/v1` : '/api/v1'
}

/**
 * Paramètres → Clés API / Agents (admin). Une clé = un compte de service
 * limité par ses scopes (<domaine>:read|write). Le secret n'est affiché
 * qu'une seule fois, juste après la création.
 */
export function ApiTokensSection() {
  const tokens = useQuery(apiTokensList, convexClient ? {} : 'skip')
  const revoke = useMutation(apiTokensRevoke)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ConvexApiToken | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke(t: ConvexApiToken) {
    if (!window.confirm(`Révoquer la clé « ${t.name} » ? L'agent ou l'automatisation qui l'utilise perdra l'accès immédiatement.`)) return
    setError(null)
    try { await revoke({ id: t.id }) } catch (err) { setError(err instanceof Error ? err.message : 'Révocation impossible') }
  }

  const active = (tokens ?? []).filter((t) => !t.revokedAt)
  const revoked = (tokens ?? []).filter((t) => t.revokedAt)

  return (
    <section className="overview-air-card" style={{ padding: 18 }} data-testid="api-tokens-section">
      <div className="shot-card-head">
        <h3>Clés API / Agents</h3>
        <span><Icon name="key" size={16} /></span>
      </div>
      <p className="text-xs text-muted mb-3">
        Donnez à un agent (Hermes, n8n, script) un accès à Velora limité aux domaines que vous cochez.
        Base : <code className="font-mono">{apiBaseUrl()}</code> · header <code className="font-mono">Authorization: Bearer vlr_…</code>.
        {' '}<a href="#/api-docs" target="_blank" rel="noreferrer" className="font-semibold text-or-dark hover:underline">Documentation de l'API ↗</a>
        {' · '}<a href={`${apiBaseUrl()}/guide.md`} target="_blank" rel="noreferrer" className="font-semibold text-or-dark hover:underline">guide.md pour agents IA ↗</a>
      </p>
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs text-faint">{active.length} clé{active.length > 1 ? 's' : ''} active{active.length > 1 ? 's' : ''}</span>
        <button type="button" onClick={() => setCreateOpen(true)} className="settings-invite">
          <Icon name="plus" size={15} /> Nouvelle clé
        </button>
      </div>
      {error && <div className="mb-2 rounded-lg bg-rouille-tint px-3 py-2 text-xs text-rouille">{error}</div>}

      {tokens === undefined ? (
        <LoadingBlock label="Chargement…" />
      ) : tokens.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted">Aucune clé pour l'instant.</div>
      ) : (
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Accès</th>
                <th>Dernier usage</th>
                <th>Expire</th>
                <th className="is-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...revoked].map((t) => (
                <TokenRow key={t.id} token={t} onEdit={() => setEditing(t)} onRevoke={() => handleRevoke(t)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && <CreateKeyModal onClose={() => setCreateOpen(false)} />}
      {editing && <EditScopesModal token={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function TokenRow({ token: t, onEdit, onRevoke }: { token: ConvexApiToken; onEdit: () => void; onRevoke: () => void }) {
  const [open, setOpen] = useState(false)
  const dead = Boolean(t.revokedAt) || (t.expiresAt !== null && t.expiresAt <= Date.now())
  return (
    <>
      <tr className={dead ? 'opacity-60' : undefined} data-testid="api-token-row">
        <td className="py-2 pr-3">
          <div className="font-semibold text-sm">{t.name}</div>
          <div className="text-[11px] font-mono text-faint">{t.prefix}… · créée le {fmtDate(t.createdAt)} par {t.createdBy}</div>
        </td>
        <td className="py-2 pr-3">
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-or-dark hover:underline inline-flex items-center gap-1">
            {summarizeScopes(t.scopes)} <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        </td>
        <td className="py-2 pr-3 text-xs text-muted">
          {t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : 'jamais'} · {t.callCount} appel{t.callCount > 1 ? 's' : ''}
        </td>
        <td className="py-2 pr-3 text-xs">
          {t.revokedAt ? (
            <span className="rounded-full bg-rouille-tint px-2 py-0.5 text-rouille font-semibold">révoquée le {fmtDate(t.revokedAt)}</span>
          ) : t.expiresAt ? (
            <span className={t.expiresAt <= Date.now() ? 'text-rouille font-semibold' : 'text-muted'}>{fmtDate(t.expiresAt)}</span>
          ) : (
            <span className="text-muted">jamais</span>
          )}
        </td>
        <td className="py-2 text-right whitespace-nowrap">
          {!t.revokedAt && (
            <>
              <button type="button" onClick={onEdit} className="settings-filter-reset mr-1" title="Modifier les scopes"><Icon name="edit" size={13} /> Scopes</button>
              <button type="button" onClick={onRevoke} className="settings-filter-reset text-rouille" title="Révoquer"><Icon name="trash" size={13} /> Révoquer</button>
            </>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="pb-3">
            <ScopeBadges scopes={t.scopes} />
          </td>
        </tr>
      )}
    </>
  )
}

function ScopeBadges({ scopes }: { scopes: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {API_DOMAINS.map((d) => {
        const r = scopeGranted(scopes, d.key, 'read')
        const w = scopeGranted(scopes, d.key, 'write')
        if (!r && !w) return null
        return (
          <span key={d.key} className="rounded-full bg-or-tint px-2 py-0.5 text-[11px] font-semibold text-or-dark">
            {d.label} · {r && w ? 'lecture + écriture' : r ? 'lecture' : 'écriture'}
          </span>
        )
      })}
      {API_DOMAINS.every((d) => !scopeGranted(scopes, d.key, 'read') && !scopeGranted(scopes, d.key, 'write')) && (
        <span className="text-xs text-muted">Aucun scope : définissez-en pour ouvrir l'accès /api/v1.</span>
      )}
    </div>
  )
}

// ─── Grille de scopes ────────────────────────────────────────────────────────

function ScopeGrid({ selected, onChange }: { selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const allRead = API_DOMAINS.every((d) => selected.has(`${d.key}:read`))
  const allWrite = API_DOMAINS.every((d) => selected.has(`${d.key}:write`))

  function toggle(scope: string) {
    const next = new Set(selected)
    if (next.has(scope)) next.delete(scope); else next.add(scope)
    onChange(next)
  }
  function toggleAll(access: 'read' | 'write', on: boolean) {
    const next = new Set(selected)
    for (const d of API_DOMAINS) {
      const s = `${d.key}:${access}`
      if (on) next.add(s); else next.delete(s)
    }
    onChange(next)
  }
  function toggleDomain(key: string) {
    const next = new Set(selected)
    const both = next.has(`${key}:read`) && next.has(`${key}:write`)
    if (both) { next.delete(`${key}:read`); next.delete(`${key}:write`) } else { next.add(`${key}:read`); next.add(`${key}:write`) }
    onChange(next)
  }

  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <div className="grid grid-cols-[1fr_88px_88px] items-center bg-black/[0.03] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-faint">
        <span>Domaine</span>
        <label className="flex items-center justify-center gap-1 cursor-pointer">
          <input type="checkbox" checked={allRead} onChange={(e) => toggleAll('read', e.target.checked)} aria-label="Tout en lecture" /> Lecture
        </label>
        <label className="flex items-center justify-center gap-1 cursor-pointer">
          <input type="checkbox" checked={allWrite} onChange={(e) => toggleAll('write', e.target.checked)} aria-label="Tout en écriture" /> Écriture
        </label>
      </div>
      <div className="max-h-[46vh] overflow-auto">
        {API_DOMAINS.map((d) => (
          <div key={d.key} className="grid grid-cols-[1fr_88px_88px] items-center border-t border-line-soft px-3 py-1.5 text-sm">
            <button type="button" onClick={() => toggleDomain(d.key)} className="text-left" title="Cocher / décocher lecture + écriture">
              <div className="font-semibold">{d.label}</div>
              <div className="text-[11px] text-faint">{d.desc}</div>
            </button>
            <div className="text-center">
              <input type="checkbox" checked={selected.has(`${d.key}:read`)} onChange={() => toggle(`${d.key}:read`)} aria-label={`${d.label} lecture`} />
            </div>
            <div className="text-center">
              <input type="checkbox" checked={selected.has(`${d.key}:write`)} onChange={() => toggle(`${d.key}:write`)} aria-label={`${d.label} écriture`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Modales ─────────────────────────────────────────────────────────────────

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-noir/40 px-4">
      <div className="settings-modal w-full max-w-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="shot-eyebrow">{eyebrow}</span>
            <h3 className="text-xl font-bold mt-1">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-text text-2xl leading-none -mt-1" aria-label="Fermer">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function CreateKeyModal({ onClose }: { onClose: () => void }) {
  const create = useMutation(apiTokensCreate)
  const [name, setName] = useState('')
  const [expDays, setExpDays] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; secret: string; scopes: string[] } | null>(null)

  const scopes = useMemo(() => compactScopes(selected), [selected])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (scopes.length === 0) { setError('Cochez au moins un domaine.'); return }
    setSaving(true); setError(null)
    try {
      const r = await create({
        name: name.trim(),
        scopes,
        ...(expDays ? { expiresAt: Date.now() + expDays * 86_400_000 } : {}),
      })
      setResult({ name: name.trim(), secret: r.secret, scopes: r.scopes })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible')
    } finally { setSaving(false) }
  }

  if (result) {
    const curl = `curl -H "Authorization: Bearer ${result.secret}" ${apiBaseUrl()}/me`
    return (
      <ModalShell eyebrow="Clé créée" title={result.name} onClose={onClose}>
        <div className="rounded-xl border border-or/40 bg-or-tint px-3 py-2.5">
          <p className="text-xs font-bold text-or-dark mb-1.5">Copiez cette clé maintenant : elle ne sera plus jamais affichée.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-white/70 px-2 py-1.5 text-xs font-mono" data-testid="api-token-secret">{result.secret}</code>
            <button type="button" className="btn-primary rounded-xl px-3 py-2 text-xs inline-flex items-center gap-1" onClick={async () => { await copyText(result.secret); notifyClipboardCopied({ message: 'Clé copiée' }) }}>
              <Icon name="edit" size={12} /> Copier
            </button>
          </div>
        </div>
        <div>
          <div className="eyebrow text-faint mb-1">Test rapide</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg border border-line bg-white/70 px-2 py-1.5 text-[11px] font-mono">{curl}</code>
            <button type="button" className="settings-filter-reset" onClick={async () => { await copyText(curl); notifyClipboardCopied({ message: 'Commande copiée' }) }}>Copier</button>
          </div>
        </div>
        <ScopeBadges scopes={result.scopes} />
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="settings-invite justify-center min-w-[120px]">Fermer</button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell eyebrow="Nouvelle clé" title="Créer une clé API" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <label className="block text-sm">
            <span className="eyebrow text-faint">Nom (à qui sert cette clé ?)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="ex. Agent Hermes" className="settings-field-input" />
          </label>
          <label className="block text-sm">
            <span className="eyebrow text-faint">Expiration</span>
            <select value={expDays ?? ''} onChange={(e) => setExpDays(e.target.value ? Number(e.target.value) : null)} className="settings-field-select">
              {EXPIRATIONS.map((o) => <option key={o.label} value={o.days ?? ''}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div>
          <div className="eyebrow text-faint mb-1">Accès accordés — {summarizeScopes(scopes)}</div>
          <ScopeGrid selected={selected} onChange={setSelected} />
        </div>
        {error && <div className="rounded-lg bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-muted hover:text-text">Annuler</button>
          <button type="submit" disabled={saving || !name.trim() || scopes.length === 0} className="settings-invite justify-center min-w-[140px]" style={{ opacity: saving || !name.trim() || scopes.length === 0 ? 0.6 : 1 }}>
            {saving ? 'Création…' : 'Générer la clé'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function EditScopesModal({ token, onClose }: { token: ConvexApiToken; onClose: () => void }) {
  const update = useMutation(apiTokensUpdateScopes)
  const [selected, setSelected] = useState<Set<string>>(() => expandToSet(token.scopes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scopes = useMemo(() => compactScopes(selected), [selected])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError(null)
    try {
      await update({ id: token.id, scopes })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mise à jour impossible')
    } finally { setSaving(false) }
  }

  return (
    <ModalShell eyebrow="Scopes" title={`Accès de « ${token.name} »`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="eyebrow text-faint">{summarizeScopes(scopes)} — effet immédiat sur les prochains appels</div>
        <ScopeGrid selected={selected} onChange={setSelected} />
        {error && <div className="rounded-lg bg-rouille-tint px-3 py-2 text-sm text-rouille">{error}</div>}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-muted hover:text-text">Annuler</button>
          <button type="submit" disabled={saving || scopes.length === 0} className="settings-invite justify-center min-w-[140px]" style={{ opacity: saving || scopes.length === 0 ? 0.6 : 1 }}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
