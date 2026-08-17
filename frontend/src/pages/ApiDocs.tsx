import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_DOMAINS } from '../lib/apiScopes'

/**
 * Page d'aide publique de l'API agents (#/api-docs) : conventions + routes,
 * générée en direct depuis /api/v1/openapi.json (toujours à jour). Sert aux
 * humains (n8n, scripts) et donne l'URL du guide Markdown pour les agents IA.
 */

type Param = { name: string; in: 'path' | 'query'; required?: boolean; description?: string; schema?: Schema }
type Schema = { type?: string; enum?: unknown[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; anyOf?: Schema[]; const?: unknown; description?: string }
type Operation = { summary: string; 'x-scope': string | null; parameters?: Param[]; requestBody?: { content: { 'application/json': { schema: Schema } } } }
type Spec = { servers: { url: string }[]; paths: Record<string, Record<string, Operation>> }

export function apiOrigin(): string {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined
  return url ? url.replace('.convex.cloud', '.convex.site') : 'https://spotted-horse-257.eu-west-1.convex.site'
}

const METHOD_TINT: Record<string, string> = {
  get: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  post: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  patch: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  delete: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

function schemaLabel(s: Schema | undefined): string {
  if (!s) return ''
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(' | ')
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (s.type === 'array') return `tableau${s.items ? ` de ${schemaLabel(s.items)}` : ''}`
  if (s.anyOf) return s.anyOf.map(schemaLabel).join(' | ')
  if (s.type === 'number') return 'nombre'
  if (s.type === 'integer') return 'entier'
  if (s.type === 'boolean') return 'booléen'
  if (s.type === 'string') return s.description ?? 'chaîne'
  if (s.type === 'object') return 'objet'
  return 'valeur'
}

export function ApiDocs() {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const base = `${apiOrigin()}/api/v1`

  useEffect(() => {
    document.title = 'Velora — API'
    fetch(`${base}/openapi.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSpec)
      .catch((e) => setError(e instanceof Error ? e.message : 'Chargement impossible'))
  }, [base])

  const groups = useMemo(() => {
    if (!spec) return []
    const map = new Map<string, Array<{ method: string; path: string; op: Operation }>>()
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const domain = op['x-scope'] ? op['x-scope'].split(':')[0] : 'meta'
        const hay = `${method} ${path} ${op.summary}`.toLowerCase()
        if (filter && !hay.includes(filter.toLowerCase())) continue
        ;(map.get(domain) ?? map.set(domain, []).get(domain)!).push({ method, path, op })
      }
    }
    const order = ['meta', ...API_DOMAINS.map((d) => d.key)]
    return order.filter((d) => map.has(d)).map((d) => ({ domain: d, routes: map.get(d)! }))
  }, [spec, filter])

  const domainLabel = (d: string) => (d === 'meta' ? 'Introspection' : API_DOMAINS.find((x) => x.key === d)?.label ?? d)
  const domainDesc = (d: string) => (d === 'meta' ? 'qui suis-je, spec, guide' : API_DOMAINS.find((x) => x.key === d)?.desc ?? '')

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.06] bg-black/80 px-6 backdrop-blur-xl sm:px-10">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/12 bg-white/[0.08] text-xs font-black">V</div>
          <p className="text-[11px] font-black uppercase tracking-[0.32em] text-white/70">VELORA · API</p>
        </Link>
        <nav className="flex items-center gap-2 text-xs">
          <a href="#conventions" className="rounded-full px-3 py-1.5 text-white/60 hover:text-white">Conventions</a>
          <a href="#routes" className="rounded-full px-3 py-1.5 text-white/60 hover:text-white">Routes</a>
          <a href={`${base}/guide.md`} target="_blank" rel="noreferrer" className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 font-bold text-white/80 hover:bg-white/12">guide.md</a>
          <a href={`${base}/openapi.json`} target="_blank" rel="noreferrer" className="rounded-full border border-white/12 bg-white/[0.07] px-3 py-1.5 font-bold text-white/80 hover:bg-white/12">openapi.json</a>
        </nav>
      </header>

      <main className="mx-auto max-w-[1080px] px-6 py-12 sm:px-10">
        <section className="mb-12">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-white/40">Documentation</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">API Velora pour agents & automatisations</h1>
          <p className="mt-4 max-w-2xl text-base text-white/60">
            Toutes les fonctionnalités de Velora — prospects, appels, rendez-vous, débriefs, devis, dossiers, délivrabilité, paiements, publicités, analytics, équipe —
            accessibles en REST avec une clé limitée aux domaines que vous choisissez. Pensée pour n8n, les scripts et les agents IA (Hermes).
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Card title="1. Créez une clé" body="Velora → Paramètres → API → « Nouvelle clé » : nom, cases Lecture / Écriture par domaine, expiration. La clé vlr_… n'est affichée qu'une fois." />
            <Card title="2. Appelez l'API" body={<>Header <code className="text-white/90">Authorization: Bearer vlr_…</code> sur <code className="text-white/90">{base}</code>. Commencez par <code className="text-white/90">GET /me</code>.</>} />
            <Card title="3. Pour un agent IA" body={<>Donnez-lui la clé et l'URL <a className="underline" href={`${base}/guide.md`} target="_blank" rel="noreferrer">{base}/guide.md</a> : règles, vocabulaire métier et toutes les routes, en Markdown, toujours à jour.</>} />
          </div>
        </section>

        <section id="conventions" className="mb-12 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
          <h2 className="text-xl font-black">Conventions</h2>
          <ul className="mt-4 space-y-2 text-sm text-white/70">
            <li><b className="text-white">Scopes</b> — <code>&lt;domaine&gt;:read</code> / <code>&lt;domaine&gt;:write</code>, presets <code>*:read</code> / <code>*:write</code>. Une route refusée renvoie <code>403 missing_scope</code> avec le scope requis.</li>
            <li><b className="text-white">Identité</b> — la clé agit comme un compte de service admin « Agent API ». Header optionnel <code>X-Acting-As: &lt;userId&gt;</code> pour agir au nom d'un utilisateur (ses droits, son attribution). Tout est tracé dans l'Historique : « Nom (via Clé API : …) ».</li>
            <li><b className="text-white">Pagination</b> — <code>?limit=</code> (1-200, défaut 50) <code>&amp;cursor=</code> → <code>{'{ items, nextCursor }'}</code>.</li>
            <li><b className="text-white">Dates</b> — millisecondes epoch (<code>scheduledAt</code>, <code>from</code>, <code>to</code>) ; <code>YYYY-MM-DD</code> pour <code>period</code> et les rapports pubs. <code>now</code> / <code>today</code> sont injectés si absents. Les query params sont typés automatiquement (<code>?active=true</code>, <code>?from=1723…</code>).</li>
            <li><b className="text-white">Erreurs</b> — <code>{'{ error: { code, message } }'}</code> : 401 clé invalide/révoquée/expirée · 403 scope manquant · 404 · 405 · 422 règle métier ou paramètre invalide (message en français) · 429 rate limit 300 req/min/clé (<code>Retry-After</code>).</li>
            <li><b className="text-white">Écritures</b> — mêmes règles et mêmes effets que dans l'application (synchro GHL, notifications, statuts dérivés) : l'API réutilise la logique métier de Velora.</li>
          </ul>
          <pre className="mt-5 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/60 p-4 text-xs leading-relaxed text-white/80">{`# Qui suis-je, quels scopes, quelles routes
curl -H "Authorization: Bearer $VELORA_API_KEY" ${base}/me

# Prospects qualifiés, 20 par page
curl -H "Authorization: Bearer $VELORA_API_KEY" "${base}/leads?status=qualifie&limit=20"

# Journaliser un appel au nom d'un setter
curl -X POST -H "Authorization: Bearer $VELORA_API_KEY" -H "X-Acting-As: <userId>" \\
  -H "content-type: application/json" \\
  -d '{"result":"rappel_planifie","notes":"Rappeler jeudi","nextCallbackAt":1724000000000}' \\
  "${base}/leads/<leadId>/calls"`}</pre>
        </section>

        <section id="routes">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black">Routes {spec ? <span className="text-white/40">({Object.values(spec.paths).reduce((n, o) => n + Object.keys(o).length, 0)})</span> : null}</h2>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrer (ex. rdv, débrief, POST…)"
              className="w-64 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
            />
          </div>
          {error && <p className="text-sm text-rose-300">Impossible de charger la spécification : {error}</p>}
          {!spec && !error && <p className="text-sm text-white/50">Chargement…</p>}
          <div className="space-y-8">
            {groups.map((g) => (
              <div key={g.domain} id={`domain-${g.domain}`}>
                <div className="mb-3 flex items-baseline gap-3">
                  <h3 className="text-lg font-black">{domainLabel(g.domain)}</h3>
                  <span className="text-xs text-white/40">{domainDesc(g.domain)}{g.domain !== 'meta' && <> · scopes <code>{g.domain}:read</code> / <code>{g.domain}:write</code></>}</span>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/[0.08] divide-y divide-white/[0.06]">
                  {g.routes.map((r) => <RouteRow key={`${r.method} ${r.path}`} method={r.method} path={r.path} op={r.op} base={apiOrigin()} />)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] px-6 py-10 sm:px-10">
        <p className="mx-auto max-w-[1080px] text-xs text-white/35">© {new Date().getFullYear()} Electro Concept OI — Velora · Les clés API se gèrent dans Paramètres → API (admin).</p>
      </footer>
    </div>
  )
}

function Card({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
      <p className="text-sm font-black">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-white/60">{body}</p>
    </div>
  )
}

function RouteRow({ method, path, op, base }: { method: string; path: string; op: Operation; base: string }) {
  const [open, setOpen] = useState(false)
  const params = (op.parameters ?? []).filter((p) => p.in === 'path')
  const query = (op.parameters ?? []).filter((p) => p.in === 'query')
  const body = op.requestBody?.content['application/json'].schema
  const bodyProps = body?.properties ? Object.entries(body.properties) : []
  const curl = method === 'get'
    ? `curl -H "Authorization: Bearer $VELORA_API_KEY" "${base}${path}"`
    : `curl -X ${method.toUpperCase()} -H "Authorization: Bearer $VELORA_API_KEY" -H "content-type: application/json" -d '{}' "${base}${path}"`
  return (
    <div className="bg-white/[0.02]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]">
        <span className={`w-16 shrink-0 rounded-md border px-2 py-0.5 text-center text-[11px] font-black uppercase ${METHOD_TINT[method] ?? ''}`}>{method}</span>
        <code className="shrink-0 text-sm text-white/90">{path.replace('/api/v1', '')}</code>
        <span className="min-w-0 flex-1 truncate text-sm text-white/55">{op.summary}</span>
        {op['x-scope'] && <span className="hidden shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/60 sm:inline">{op['x-scope']}</span>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/[0.06] px-4 py-4 text-xs">
          {params.length > 0 && <ParamTable title="Paramètres de chemin" rows={params.map((p) => [p.name, 'chaîne (id)', true, ''])} />}
          {query.length > 0 && <ParamTable title="Query" rows={query.map((p) => [p.name, schemaLabel(p.schema), Boolean(p.required), p.description ?? ''])} />}
          {bodyProps.length > 0 && <ParamTable title="Body JSON" rows={bodyProps.map(([k, s]) => [k, schemaLabel(s), Boolean(body?.required?.includes(k)), ''])} />}
          {params.length === 0 && query.length === 0 && bodyProps.length === 0 && <p className="text-white/50">Aucun paramètre.</p>}
          <pre className="overflow-x-auto rounded-lg bg-black/60 p-3 text-[11px] text-white/75">{curl}</pre>
        </div>
      )}
    </div>
  )
}

function ParamTable({ title, rows }: { title: string; rows: Array<[string, string, boolean, string]> }) {
  return (
    <div>
      <p className="mb-1.5 font-black uppercase tracking-wide text-white/40">{title}</p>
      <table className="w-full text-left">
        <tbody>
          {rows.map(([name, type, required, desc]) => (
            <tr key={name} className="border-t border-white/[0.05]">
              <td className="py-1 pr-3 align-top"><code className="text-white/90">{name}</code>{required && <span className="ml-1 text-rose-300">*</span>}</td>
              <td className="py-1 pr-3 align-top text-white/60">{type}</td>
              <td className="py-1 align-top text-white/40">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
