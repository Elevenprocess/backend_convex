import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Icon } from '../Icon'
import { apiTokensCreate, apiTokensList, apiTokensRevoke } from '../../lib/convexApi'
import { copyText } from '../../lib/hooks'
import { notifyClipboardCopied } from '../../lib/clipboardToast'
import { convexClient } from '../../lib/convex'

const fmt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * Paramètres → API : création / révocation de tokens de service. Le secret
 * n'est affiché qu'une fois, juste après la création.
 */
export function ApiTokensSection() {
  const tokens = useQuery(apiTokensList, convexClient ? {} : 'skip')
  const create = useMutation(apiTokensCreate)
  const revoke = useMutation(apiTokensRevoke)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ name: string; secret: string } | null>(null)
  const apiBase = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace('.convex.cloud', '.convex.site') ?? ''

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const r = await create({ name: name.trim() })
      setFresh({ name: name.trim(), secret: r.secret })
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible')
    } finally { setBusy(false) }
  }

  async function handleRevoke(id: string, label: string) {
    if (!window.confirm(`Révoquer le token « ${label} » ? Les intégrations qui l'utilisent cesseront de fonctionner.`)) return
    try { await revoke({ id }) } catch (err) { setError(err instanceof Error ? err.message : 'Révocation impossible') }
  }

  const active = (tokens ?? []).filter((t) => !t.revokedAt)
  const revoked = (tokens ?? []).filter((t) => t.revokedAt)

  return (
    <div className="space-y-4">
      <section className="overview-air-card" style={{ padding: 18 }}>
        <div className="shot-card-head">
          <h3>Créer un token</h3>
          <span><Icon name="key" size={16} /></span>
        </div>
        <p className="text-xs text-muted mb-3">
          Un token donne accès en lecture à l'API de service (KPI, RDV, débriefs) pour vos automatisations (n8n, agents, scripts).
          Il n'est affiché qu'une seule fois : copiez-le immédiatement.
        </p>
        <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom du token (ex. n8n débriefs)"
            aria-label="Nom du token"
            className="settings-input flex-1 min-w-[220px]"
            maxLength={60}
          />
          <button type="submit" disabled={busy || !name.trim()} className="settings-invite" style={{ opacity: busy || !name.trim() ? 0.6 : 1 }}>
            <Icon name="plus" size={15} /> Générer
          </button>
        </form>
        {error && <p className="mt-2 text-xs font-semibold text-rouille">{error}</p>}
        {fresh && (
          <div className="mt-3 rounded-lg border border-or/40 bg-or-tint px-3 py-2.5">
            <p className="text-xs font-bold text-or-dark mb-1.5">Token « {fresh.name} » créé — copiez-le maintenant, il ne sera plus visible.</p>
            <div className="flex items-center gap-2">
              <code className="settings-token flex-1 min-w-0 truncate">{fresh.secret}</code>
              <button
                type="button"
                className="settings-filter-reset"
                onClick={async () => { await copyText(fresh.secret); notifyClipboardCopied() }}
              >
                <Icon name="copy" size={12} /> Copier
              </button>
              <button type="button" className="settings-filter-reset" onClick={() => setFresh(null)} aria-label="Masquer"><Icon name="x" size={12} /></button>
            </div>
            {apiBase && (
              <p className="mt-2 text-[11px] text-muted">
                Usage : passer le token dans l'argument <code>apiKey</code> des fonctions <code>hermes:kpis</code>, <code>hermes:rdvList</code>, <code>hermesDebrief:due</code> — déploiement <code>{apiBase.replace('.convex.site', '')}</code>.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="overview-air-card" style={{ padding: 18 }}>
        <div className="shot-card-head">
          <h3>Tokens actifs {tokens && <span className="settings-count-pill">{active.length}</span>}</h3>
        </div>
        {tokens === undefined ? (
          <p className="py-6 text-center text-xs text-faint">Chargement…</p>
        ) : active.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">Aucun token actif.</p>
        ) : (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Nom</th><th>Préfixe</th><th>Créé</th><th>Dernier usage</th><th className="is-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 pr-3 font-semibold text-text">{t.name}<span className="block text-[11px] font-normal text-faint">par {t.createdBy}</span></td>
                    <td className="py-2.5 pr-3"><code className="settings-token">{t.prefix}…</code></td>
                    <td className="py-2.5 pr-3 text-muted">{fmt(t.createdAt)}</td>
                    <td className="py-2.5 pr-3 text-muted">{t.lastUsedAt ? fmt(t.lastUsedAt) : 'jamais'}</td>
                    <td className="py-2.5 text-right">
                      <button type="button" className="settings-filter-reset text-rouille" onClick={() => handleRevoke(t.id, t.name)}>
                        <Icon name="trash" size={12} /> Révoquer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {revoked.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-muted">{revoked.length} token{revoked.length > 1 ? 's' : ''} révoqué{revoked.length > 1 ? 's' : ''}</summary>
            <ul className="mt-2 space-y-1">
              {revoked.map((t) => (
                <li key={t.id} className="text-xs text-faint line-through">{t.name} · {t.prefix}… · révoqué le {fmt(t.revokedAt!)}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
