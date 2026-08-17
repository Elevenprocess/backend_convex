/**
 * Miroir front de convex/model/apiScopes.ts (labels FR des domaines de l'API
 * agents). Garder les deux listes alignées : le backend est la source de vérité
 * (normalizeScopes rejette un scope inconnu).
 */
export const API_DOMAINS = [
  { key: 'leads', label: 'Prospects', desc: 'fiches, statuts, qualification, attribution, source-map' },
  { key: 'rdv', label: 'Rendez-vous', desc: 'liste, création, reprogrammation, statut' },
  { key: 'calls', label: 'Appels', desc: "journal d'appels, rappels" },
  { key: 'debriefs', label: 'Débriefs', desc: 'comptes-rendus de RDV' },
  { key: 'devis', label: 'Devis', desc: 'devis, signature, PDF' },
  { key: 'projects', label: 'Dossiers', desc: 'projets, étapes, sous-étapes, documents' },
  { key: 'clients', label: 'Clients', desc: 'dossiers clients, techniciens, VT' },
  { key: 'payments', label: 'Paiements', desc: 'acomptes, échéanciers, financement' },
  { key: 'ads', label: 'Publicités', desc: 'dépenses, rapport, dépôts' },
  { key: 'analytics', label: 'Analytics', desc: 'KPI, funnel, classements, pipeline' },
  { key: 'users', label: 'Utilisateurs', desc: 'annuaire, rôles, invitations' },
  { key: 'notifications', label: 'Notifications', desc: 'lecture / marquage' },
  { key: 'objectives', label: 'Objectifs', desc: 'objectifs commerciaux' },
  { key: 'referrers', label: 'Apporteurs', desc: "apporteurs d'affaires" },
  { key: 'calendar', label: 'Agenda GHL', desc: 'créneaux, événements, RDV GHL — routes à venir' },
  { key: 'activity', label: 'Historique', desc: "journal d'activité" },
] as const

export type ApiDomain = (typeof API_DOMAINS)[number]['key']
export type ApiAccess = 'read' | 'write'

export const ALL_READ = API_DOMAINS.map((d) => `${d.key}:read`)
export const ALL_WRITE = API_DOMAINS.map((d) => `${d.key}:write`)

/** Une clé « voit » un scope concret si elle l'a, ou via le preset `*:<access>`. */
export function scopeGranted(scopes: readonly string[], domain: string, access: ApiAccess): boolean {
  return scopes.includes(`${domain}:${access}`) || scopes.includes(`*:${access}`)
}

/** Résumé lisible : « Tout », « Tout (lecture) », « 3 domaines », … */
export function summarizeScopes(scopes: readonly string[]): string {
  const read = scopes.includes('*:read')
  const write = scopes.includes('*:write')
  if (read && write) return 'Tout (lecture + écriture)'
  const domains = new Set(scopes.filter((s) => !s.startsWith('*:')).map((s) => s.split(':')[0]))
  const parts: string[] = []
  if (read) parts.push('Tout en lecture')
  if (write) parts.push('Tout en écriture')
  if (domains.size) parts.push(`${domains.size} domaine${domains.size > 1 ? 's' : ''}`)
  return parts.join(' + ') || 'Aucun accès'
}

/** Compacte une sélection : si tous les domaines d'un accès sont cochés → preset. */
export function compactScopes(selected: ReadonlySet<string>): string[] {
  const out = new Set<string>()
  for (const access of ['read', 'write'] as const) {
    const all = API_DOMAINS.every((d) => selected.has(`${d.key}:${access}`))
    if (all) out.add(`*:${access}`)
    else for (const d of API_DOMAINS) if (selected.has(`${d.key}:${access}`)) out.add(`${d.key}:${access}`)
  }
  return [...out].sort()
}

/** Développe presets → cases cochées (état de la grille). */
export function expandToSet(scopes: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const s of scopes) {
    if (s === '*:read') ALL_READ.forEach((x) => out.add(x))
    else if (s === '*:write') ALL_WRITE.forEach((x) => out.add(x))
    else out.add(s)
  }
  return out
}
