/**
 * Garde « acompte » côté délivrabilité : relie le workflow d'un dossier à son
 * échéancier finances (piloté par le devis — cf. assembleEcheancier).
 *
 *  - acompteStateForClient : échéancier complet du dossier (via son débrief
 *    vente, projet prioritaire sinon lead) ;
 *  - blockingTranche : la tranche impayée qui INTERDIT de cocher un jalon —
 *    on ne franchit pas le jalon de la tranche N tant qu'une tranche
 *    antérieure due (à encaisser / en retard) n'est pas encaissée.
 */
import { QueryCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { assembleEcheancier, AcompteResponse, EcheanceLine } from "./assembleEcheancier";

/** Date du jour YYYY-MM-DD au fuseau La Réunion (UTC+4). */
export function todayReunion(nowMs: number = Date.now()): string {
  return new Date(nowMs + 4 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function findVenteDebriefForClient(
  ctx: QueryCtx,
  client: Doc<"clients">,
): Promise<Doc<"debriefs"> | null> {
  if (client.projectId !== undefined) {
    const byProject = await ctx.db
      .query("debriefs")
      .withIndex("by_project", (q) => q.eq("projectId", client.projectId))
      .collect();
    const vente = byProject.find((d) => d.outcome === "vente" && d.deletedAt === undefined);
    if (vente) return vente;
  }
  const byLead = await ctx.db
    .query("debriefs")
    .withIndex("by_lead", (q) => q.eq("leadId", client.leadId))
    .collect();
  return byLead.find((d) => d.outcome === "vente" && d.deletedAt === undefined) ?? null;
}

/** Échéancier du dossier, ou null (pas de débrief vente / pas de plan). */
export async function acompteStateForClient(
  ctx: QueryCtx,
  client: Doc<"clients">,
  today: string = todayReunion(),
): Promise<AcompteResponse | null> {
  const debrief = await findVenteDebriefForClient(ctx, client);
  if (!debrief) return null;
  return await assembleEcheancier(ctx, debrief, { today });
}

/** Statuts qui bloquent : tranche due (jalon franchi) non encaissée. */
const DUE_STATUSES = new Set(["a_encaisser", "en_retard"]);

/**
 * Tranche impayée bloquant le passage à « fait » du jalon `targetKey`.
 * Une étape qui n'est le jalon d'aucune tranche n'est jamais bloquée.
 */
export function blockingTranche(
  echeances: EcheanceLine[],
  targetKey: string,
): EcheanceLine | null {
  const target = echeances.find((e) => e.jalonKey === targetKey);
  if (!target) return null;
  return (
    echeances.find((e) => e.ordre < target.ordre && DUE_STATUSES.has(e.statut)) ?? null
  );
}

export function formatEuro(montant: number | null): string {
  if (montant == null) return "";
  return `${montant.toLocaleString("fr-FR")} €`;
}
