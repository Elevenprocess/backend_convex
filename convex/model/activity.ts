/**
 * Journal d'activité (table `activityLog`) — point d'entrée UNIQUE d'écriture.
 *
 *  - logActivity(ctx, …)       : action faite par le user connecté (mutation).
 *  - logSystemActivity(ctx, …) : événement sans session (webhook GHL, lien
 *                                débrief WhatsApp, cron, agent Hermes).
 *
 * Chaque ligne porte une phrase française prête à afficher (`summary`), le
 * côté métier de l'acteur (`domain`), l'entité touchée et ses rattachements
 * (lead / dossier client) pour filtrer et naviguer.
 *
 * Best-effort : un échec de journalisation ne doit JAMAIS faire échouer la
 * mutation métier — les helpers avalent leurs erreurs.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActivityDomain, Role } from "./enums";
import { getCurrentUser, getRealUser, roleOf } from "./access";

// ─── Libellés FR ─────────────────────────────────────────────────────────────

export const LEAD_STATUS_LABEL: Record<string, string> = {
  nouveau: "Nouveau",
  qualifie: "Qualifié",
  rdv_pris: "RDV pris",
  rdv_honore: "RDV honoré",
  signature_en_cours: "Signature en cours",
  signe: "Signé",
  perdu: "Perdu",
  relance: "Relance",
  pas_qualifie: "Pas qualifié",
  a_rappeler: "À rappeler",
  pas_de_reponse: "Pas de réponse",
};

export const CALL_RESULT_LABEL: Record<string, string> = {
  joint: "joint",
  non_joint: "non joint",
  rappel_planifie: "rappel planifié",
  rdv_pris: "RDV pris",
  refus: "refus",
  injoignable: "injoignable",
  messagerie: "messagerie",
};

export const RDV_STATUS_LABEL: Record<string, string> = {
  planifie: "planifié",
  honore: "honoré",
  no_show: "no-show",
  reporte: "reporté",
  annule: "annulé",
};

export const RDV_RESULT_LABEL: Record<string, string> = {
  signe: "signé",
  reflexion: "en réflexion",
  perdu: "perdu",
  no_show: "no-show",
  reporte: "reporté",
};

export const DEBRIEF_OUTCOME_LABEL: Record<string, string> = {
  vente: "vente",
  non_vente: "non-vente",
  en_reflexion: "en réflexion",
  suivi_prevu: "suivi prévu",
};

export const WORKFLOW_STATUS_LABEL: Record<string, string> = {
  a_faire: "à faire",
  planifie: "planifié",
  en_cours: "en cours",
  fait: "fait",
  probleme: "problème",
  en_attente: "en attente",
  annule: "annulé",
};

export const WORKFLOW_PHASE_LABEL: Record<string, string> = {
  vt: "Visite technique",
  dp: "Déclaration préalable",
  racco: "Raccordement",
  installation: "Installation",
  consuel: "Consuel",
  mes: "Mise en service",
};

export const CLIENT_STATUS_LABEL: Record<string, string> = {
  nouveau: "Nouveau",
  vt_a_faire: "VT à faire",
  administratif_en_cours: "Administratif en cours",
  installation_planifiee: "Installation planifiée",
  installe_en_attente_mes: "Installé, en attente MES",
  cloture: "Clôturé",
  bloque: "Bloqué",
  annule: "Annulé",
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  setter: "Setter",
  setter_lead: "Setter lead",
  commercial: "Commercial",
  commercial_lead: "Commercial lead",
  delivrabilite: "Délivrabilité",
  responsable_technique: "Responsable technique",
  back_office: "Back-office",
  technicien: "Technicien",
  finances: "Finances",
};

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return map[value] ?? value;
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  // Heure de La Réunion (UTC+4) — équipe basée à La Réunion.
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Indian/Reunion",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms)).replace(",", " à");
}

export function fmtEur(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)} €`;
}

// ─── Côté métier ─────────────────────────────────────────────────────────────

export function domainForRole(role: Role | string | undefined): ActivityDomain {
  switch (role) {
    case "setter":
    case "setter_lead":
      return "setting";
    case "commercial":
    case "commercial_lead":
      return "closing";
    case "delivrabilite":
    case "responsable_technique":
    case "back_office":
    case "technicien":
      return "delivrabilite";
    case "finances":
      return "finances";
    case "admin":
      return "admin";
    default:
      return "system";
  }
}

// ─── Libellés d'entités ──────────────────────────────────────────────────────

export function userLabel(user: Doc<"users"> | null | undefined): string {
  if (!user) return "Utilisateur inconnu";
  return (user.name ?? "").trim() || user.email || "Utilisateur";
}

export function leadLabel(lead: Doc<"leads"> | null | undefined): string {
  if (!lead) return "Prospect inconnu";
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return name || lead.phone || lead.email || "Prospect sans nom";
}

export async function leadLabelById(
  ctx: MutationCtx,
  leadId: Id<"leads"> | undefined | null,
): Promise<{ lead: Doc<"leads"> | null; subject: string }> {
  if (!leadId) return { lead: null, subject: "Prospect inconnu" };
  const lead = await ctx.db.get(leadId);
  return { lead, subject: leadLabel(lead) };
}

export async function userLabelById(
  ctx: MutationCtx,
  userId: Id<"users"> | undefined | null,
): Promise<string> {
  if (!userId) return "—";
  return userLabel(await ctx.db.get(userId));
}

// ─── Écriture ────────────────────────────────────────────────────────────────

export type ActivityInput = {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  subject?: string;
  leadId?: Id<"leads">;
  clientId?: Id<"clients">;
  details?: unknown;
  /** Horodatage explicite (défaut : maintenant). */
  at?: number;
  /**
   * Sans session (mutation interne lancée hors action authentifiée), journalise
   * quand même en tant que système avec cette source ; sinon rien n'est écrit.
   */
  fallbackSource?: string;
};

/**
 * Journalise une action du user connecté. L'acteur est le user RÉEL (session) ;
 * si un admin est en mode « Explorer un profil », le profil emprunté est noté
 * dans `viaUserId`. Silencieux si aucune session (ne devrait pas arriver dans
 * une mutation protégée) — dans ce cas rien n'est écrit.
 */
export async function logActivity(ctx: MutationCtx, input: ActivityInput): Promise<void> {
  try {
    const real = await getRealUser(ctx);
    if (!real) {
      if (input.fallbackSource) {
        const { fallbackSource, ...rest } = input;
        await logSystemActivity(ctx, { ...rest, source: fallbackSource });
      }
      return;
    }
    let via: Doc<"users"> | null = null;
    try {
      const current = await getCurrentUser(ctx);
      if (current && current._id !== real._id) via = current;
    } catch {
      via = null;
    }
    await ctx.db.insert("activityLog", {
      at: input.at ?? Date.now(),
      actorId: real._id,
      actorName: userLabel(real),
      actorRole: roleOf(real),
      domain: domainForRole(roleOf(real)),
      ...(via ? { viaUserId: via._id } : {}),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      summary: input.summary,
      ...(input.details !== undefined ? { details: input.details } : {}),
    });
  } catch (err) {
    console.warn("activityLog: échec de journalisation (ignoré)", err);
  }
}

/**
 * Journalise un événement sans session utilisateur. `actorName` = source
 * (« GHL », « Lien débrief », « Cron », « Hermes »). Si un user est identifiable
 * (ex. commercial GHL assigné, commercial du RDV), le passer en `onBehalfOf` :
 * la ligne lui est rattachée (actorId + domaine de son rôle) tout en gardant
 * la source dans `details.source`.
 */
export async function logSystemActivity(
  ctx: MutationCtx,
  input: ActivityInput & { source: string; onBehalfOf?: Id<"users"> | null },
): Promise<void> {
  try {
    const user = input.onBehalfOf ? await ctx.db.get(input.onBehalfOf) : null;
    const details =
      input.details && typeof input.details === "object"
        ? { source: input.source, ...(input.details as Record<string, unknown>) }
        : { source: input.source };
    await ctx.db.insert("activityLog", {
      at: input.at ?? Date.now(),
      ...(user ? { actorId: user._id } : {}),
      actorName: user ? `${userLabel(user)} (via ${input.source})` : input.source,
      ...(user ? { actorRole: roleOf(user) } : {}),
      domain: user ? domainForRole(roleOf(user)) : "system",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      summary: input.summary,
      details,
    });
  } catch (err) {
    console.warn("activityLog: échec de journalisation système (ignoré)", err);
  }
}

/** Diff lisible : ne garde que les clés dont la valeur change réellement. */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
  const changed: string[] = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    const prev = before ? before[k] : undefined;
    if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null)) continue;
    changed.push(k);
    b[k] = prev ?? null;
    a[k] = next;
  }
  return { changed, before: b, after: a };
}

/** Libellés FR des champs les plus courants pour les phrases « a modifié … ». */
export const FIELD_LABEL: Record<string, string> = {
  firstName: "prénom",
  lastName: "nom",
  email: "email",
  phone: "téléphone",
  addressLine: "adresse",
  city: "ville",
  postalCode: "code postal",
  localisationMap: "localisation",
  revenuFiscal: "revenu fiscal",
  typeLogement: "type de logement",
  datePassageRelance: "date de relance",
  assignedToId: "commercial assigné",
  status: "statut",
  notes: "notes",
  scheduledAt: "date du RDV",
  montantTotal: "montant total",
  financingType: "type de financement",
  objections: "objections",
  nonSaleReason: "raison de non-vente",
  kits: "kits",
  signatureAt: "date de signature",
  debriefFilledAt: "date de débrief",
  result: "résultat",
  outcome: "issue",
  name: "nom",
  role: "rôle",
  team: "équipe",
  active: "actif",
  datePlanifiee: "date planifiée",
  dateRealisee: "date réalisée",
  deadline: "échéance",
  responsableId: "responsable",
  problemReason: "motif du problème",
  problemNotes: "notes du problème",
  heure: "heure",
  metadata: "métadonnées",
};

export function fieldsSentence(changed: string[]): string {
  if (changed.length === 0) return "";
  return changed.map((k) => FIELD_LABEL[k] ?? k).join(", ");
}
