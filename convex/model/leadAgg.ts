// Agrégats dénormalisés du lead (champ leads.agg) — remède au N+1 de
// enrichLead : la liste leads relisait TOUS les callLogs/rdv/devis/clients/
// stageHistory de chaque lead à CHAQUE ré-exécution réactive (~450 Ko lus par
// exécution, ~1 To/mois facturé). Les agrégats sont désormais recalculés à
// l'ÉCRITURE (refreshLeadAgg, un seul lead → bon marché) et la lecture ne
// coûte plus que le document lead lui-même.
//
// Règles :
// - `agg` ne stocke QUE des valeurs indépendantes de l'heure de lecture ; tout
//   ce qui dépend de `now` (callsToday, joursSansContact…) est dérivé à la
//   lecture dans enrichFromAgg à partir des timestamps stockés.
// - Les champs qui retombent sur le doc lead (setterId, assignedToId,
//   lastContactAt) sont fusionnés à la LECTURE — un patch du lead ne passe pas
//   par refreshLeadAgg et ne doit jamais périmer l'agg.
// - Toute mutation qui écrit callLogs/rdv/devis/clients/leadStageHistory doit
//   appeler refreshLeadAgg (directement ou via insertStageHistory /
//   recomputeClientStatus). Un agg absent ou d'une autre version retombe sur
//   le calcul live : oublier un site d'écriture rend l'agg périmé, pas faux —
//   bump AGG_VERSION pour forcer le recalcul global après un changement de forme.
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const AGG_VERSION = 1;

const REUNION_OFFSET_MS = 4 * 60 * 60 * 1000;

export function reunionDayKey(ms: number): string {
  return new Date(ms + REUNION_OFFSET_MS).toISOString().slice(0, 10);
}

export type LeadAgg = NonNullable<Doc<"leads">["agg"]>;

/** Recalcule les agrégats d'UN lead depuis les tables sources (5 requêtes
 * indexées sur ce seul lead). Reprend à l'identique la logique historique
 * d'enrichLead — les tests de parité leads_enriched.test.ts couvrent les deux
 * chemins (agg stocké vs calcul live). */
export async function computeLeadAgg(ctx: QueryCtx, lead: Doc<"leads">): Promise<LeadAgg> {
  // Appels (du plus récent au plus ancien via l'index).
  const calls = await ctx.db
    .query("callLogs")
    .withIndex("by_lead_calledAt", (q) => q.eq("leadId", lead._id))
    .order("desc")
    .collect();
  const latestCall = calls[0];
  const callDays = new Set<string>();
  const callSetterIds: Id<"users">[] = [];
  const seenSetters = new Set<Id<"users">>();
  let latestCallComment: string | undefined;
  let nextCallbackAt: number | undefined;
  let callbackSetAt: number | undefined;
  let firstCallAt: number | undefined;
  for (const call of calls) {
    callDays.add(reunionDayKey(call.calledAt));
    if (call.setterId && !seenSetters.has(call.setterId)) {
      seenSetters.add(call.setterId);
      callSetterIds.push(call.setterId);
    }
    if (latestCallComment === undefined && call.notes?.trim()) latestCallComment = call.notes.trim();
    if (nextCallbackAt === undefined && call.nextCallbackAt !== undefined) {
      nextCallbackAt = call.nextCallbackAt;
      callbackSetAt = call.calledAt;
    }
    firstCallAt = firstCallAt === undefined ? call.calledAt : Math.min(firstCallAt, call.calledAt);
  }
  const lastCallDayKey = latestCall ? reunionDayKey(latestCall.calledAt) : undefined;
  const callsOnLastCallDay = lastCallDayKey
    ? calls.filter((c) => reunionDayKey(c.calledAt) === lastCallDayKey).length
    : 0;

  // RDV (le plus récent par scheduledAt ; premier créé = transfert).
  const rdvs = await ctx.db
    .query("rdv")
    .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
    .collect();
  let latestRdv: Doc<"rdv"> | undefined;
  let transferredAt: number | undefined;
  let latestDebriefAt: number | undefined;
  for (const r of rdvs) {
    if (r.deletedAt !== undefined) continue;
    if (!latestRdv || (r.scheduledAt ?? 0) > (latestRdv.scheduledAt ?? 0)) latestRdv = r;
    const rCreatedAt = r.createdAt ?? r._creationTime;
    transferredAt = transferredAt === undefined ? rCreatedAt : Math.min(transferredAt, rCreatedAt);
    if (r.debriefFilledAt !== undefined) {
      latestDebriefAt = latestDebriefAt === undefined ? r.debriefFilledAt : Math.max(latestDebriefAt, r.debriefFilledAt);
    }
  }

  // Devis (présence + dernier en date).
  const devisRows = (await ctx.db.query("devis").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect())
    .filter((d) => d.deletedAt === undefined);
  const latestDevisAt = devisRows.reduce<number | undefined>(
    (acc, d) => (acc === undefined ? d._creationTime : Math.max(acc, d._creationTime)), undefined);

  // Dossier délivrabilité actif → statut affiché à la place de "signé".
  const dossier = (await ctx.db.query("clients").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect())
    .find((c) => c.deletedAt === undefined);

  // Historique de stage (premier = arrivée, dernier = ancienneté).
  const stages = await ctx.db
    .query("leadStageHistory")
    .withIndex("by_lead_changedAt", (q) => q.eq("leadId", lead._id))
    .collect();
  let firstStageAt: number | undefined;
  let lastStageChangeAt: number | undefined;
  for (const s of stages) {
    firstStageAt = firstStageAt === undefined ? s.changedAt : Math.min(firstStageAt, s.changedAt);
    lastStageChangeAt = lastStageChangeAt === undefined ? s.changedAt : Math.max(lastStageChangeAt, s.changedAt);
  }

  return {
    v: AGG_VERSION,
    updatedAt: Date.now(),
    latestCallAt: latestCall?.calledAt,
    firstCallAt,
    latestCallComment,
    latestCallSetterId: latestCall?.setterId,
    callSetterIds,
    callCount: calls.length,
    distinctCallDays: callDays.size,
    lastCallDayKey,
    callsOnLastCallDay,
    nextCallbackAt,
    callbackSetAt,
    latestRdvAt: latestRdv?.scheduledAt,
    latestRdvStatus: latestRdv?.status,
    latestRdvCommercialId: latestRdv?.commercialId,
    transferredAt,
    hasDevis: devisRows.length > 0,
    latestDevisAt,
    latestDebriefAt,
    lastStageChangeAt,
    firstStageAt,
    delivrabiliteStatus: dossier?.statusGlobal,
  };
}

/** Recalcule et stocke l'agg d'un lead. À appeler à la fin de toute mutation
 * qui a écrit dans une table source. No-op si le lead n'existe plus (suppression
 * en cascade). Un double appel dans une même mutation est inoffensif. */
export async function refreshLeadAgg(ctx: MutationCtx, leadId: Id<"leads">): Promise<void> {
  const lead = await ctx.db.get(leadId);
  if (!lead) return;
  await ctx.db.patch(leadId, { agg: await computeLeadAgg(ctx, lead) });
}
