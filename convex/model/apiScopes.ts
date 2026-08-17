/**
 * Scopes de l'API agents (/api/v1) — source de vérité UNIQUE.
 *
 * Un scope = `<domaine>:<read|write>`. Presets `*:read` / `*:write` (tout en
 * lecture / tout en écriture). Le domaine `apikeys` (gestion des clés) n'est
 * jamais accordable à une clé : il reste réservé aux admins connectés.
 *
 * Miroir front : frontend/src/lib/apiScopes.ts (labels identiques).
 */

export const API_DOMAINS = [
  { key: "leads", label: "Prospects", desc: "fiches, statuts, qualification, attribution, source-map" },
  { key: "rdv", label: "Rendez-vous", desc: "liste, création, reprogrammation, statut" },
  { key: "calls", label: "Appels", desc: "journal d'appels, rappels" },
  { key: "debriefs", label: "Débriefs", desc: "comptes-rendus de RDV" },
  { key: "devis", label: "Devis", desc: "devis, signature, PDF" },
  { key: "projects", label: "Dossiers", desc: "projets, étapes, sous-étapes, documents" },
  { key: "clients", label: "Clients", desc: "dossiers clients, techniciens, VT" },
  { key: "payments", label: "Paiements", desc: "acomptes, échéanciers, financement" },
  { key: "ads", label: "Publicités", desc: "dépenses, rapport, dépôts" },
  { key: "analytics", label: "Analytics", desc: "KPI, funnel, classements, pipeline" },
  { key: "users", label: "Utilisateurs", desc: "annuaire, rôles, invitations" },
  { key: "notifications", label: "Notifications", desc: "lecture / marquage" },
  { key: "objectives", label: "Objectifs", desc: "objectifs commerciaux" },
  { key: "referrers", label: "Apporteurs", desc: "apporteurs d'affaires" },
  { key: "calendar", label: "Agenda GHL", desc: "créneaux, événements, RDV GHL — routes à venir" },
  { key: "activity", label: "Historique", desc: "journal d'activité" },
] as const;

export type ApiDomain = (typeof API_DOMAINS)[number]["key"];
export type ApiAccess = "read" | "write";
export type ApiScope = `${ApiDomain}:${ApiAccess}` | "*:read" | "*:write";

export const API_ACCESSES: readonly ApiAccess[] = ["read", "write"];

export const ALL_SCOPES: ApiScope[] = API_DOMAINS.flatMap((d) =>
  API_ACCESSES.map((a) => `${d.key}:${a}` as ApiScope),
);

const DOMAIN_KEYS = new Set<string>(API_DOMAINS.map((d) => d.key));

export function isValidScope(s: string): s is ApiScope {
  if (s === "*:read" || s === "*:write") return true;
  const [domain, access] = s.split(":");
  return DOMAIN_KEYS.has(domain) && (access === "read" || access === "write");
}

/** Normalise une liste : valide, dédoublonne, ordonne. Jette si scope inconnu. */
export function normalizeScopes(input: readonly string[]): ApiScope[] {
  const out = new Set<ApiScope>();
  for (const raw of input) {
    const s = raw.trim();
    if (!s) continue;
    if (!isValidScope(s)) throw new Error(`Scope inconnu : ${s}`);
    out.add(s);
  }
  return [...out].sort();
}

/**
 * `write` n'implique PAS `read` (une clé peut pousser des données sans lire) —
 * mais `*:write` couvre tout `<d>:write`, `*:read` tout `<d>:read`.
 */
export function hasScope(granted: readonly string[], required: `${ApiDomain}:${ApiAccess}`): boolean {
  if (granted.includes(required)) return true;
  const access = required.split(":")[1] as ApiAccess;
  return granted.includes(`*:${access}`);
}

/** Développe les presets en scopes concrets (pour l'affichage). */
export function expandScopes(granted: readonly string[]): ApiScope[] {
  const out = new Set<ApiScope>();
  for (const s of granted) {
    if (s === "*:read" || s === "*:write") {
      const access = s.split(":")[1] as ApiAccess;
      for (const d of API_DOMAINS) out.add(`${d.key}:${access}` as ApiScope);
    } else if (isValidScope(s)) out.add(s);
  }
  return [...out].sort();
}
