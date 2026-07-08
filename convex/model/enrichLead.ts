// Enrichissement read-side d'un lead — portage de LeadsService.withLatestCalls
// (appels, RDV, devis, débrief, dossier délivrabilité, compteurs dérivés). Le
// `jauge11Jours` (Airtable) est hors périmètre Convex. `now` est fourni par
// l'appelant (queries déterministes). Réunion = UTC+4 sans DST.
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const DAY_MS = 86_400_000;
const REUNION_OFFSET_MS = 4 * 60 * 60 * 1000;

function reunionDayKey(ms: number): string {
  return new Date(ms + REUNION_OFFSET_MS).toISOString().slice(0, 10);
}

function daysSince(ts: number | undefined, now: number): number | undefined {
  return ts === undefined ? undefined : Math.floor((now - ts) / DAY_MS);
}

/** Date de création MÉTIER : createdAt (vraie date Render migrée) prime sur
 * _creationTime (= jour de migration, uniforme et non antidatable). */
function bizCreatedAt(doc: { createdAt?: number; _creationTime: number }): number {
  return doc.createdAt ?? doc._creationTime;
}

export type EnrichedLead = Doc<"leads"> & {
  latestCallAt?: number;
  firstCallAt?: number;
  latestCallComment?: string;
  latestCallSetterId?: Id<"users">;
  assignedSetterIds: Id<"users">[];
  callCount: number;
  callsToday: number;
  nextCallbackAt?: number;
  callbackSetAt?: number;
  joursSansContact?: number;
  joursRelance?: number;
  latestRdvAt?: number;
  latestRdvStatus?: string;
  latestRdvCommercialId?: Id<"users">;
  transferredAt?: number;
  hasDevis: boolean;
  latestDevisAt?: number;
  hasDebrief: boolean;
  latestDebriefAt?: number;
  lastStageChangeAt?: number;
  arrivalAt: number;
  daysSinceLastStageChange?: number;
  delivrabiliteStatus?: string;
};

export async function enrichLead(
  ctx: QueryCtx,
  lead: Doc<"leads">,
  now: number,
): Promise<EnrichedLead> {
  const todayKey = reunionDayKey(now);

  // Appels (triés du plus récent au plus ancien via l'index).
  const calls = await ctx.db
    .query("callLogs")
    .withIndex("by_lead_calledAt", (q) => q.eq("leadId", lead._id))
    .order("desc")
    .collect();
  const latestCall = calls[0];
  const callDays = new Set<string>();
  const setterIds = new Set<Id<"users">>();
  let callsToday = 0;
  let latestCallComment: string | undefined;
  let nextCallbackAt: number | undefined;
  let callbackSetAt: number | undefined;
  let firstCallAt: number | undefined;
  for (const call of calls) {
    callDays.add(reunionDayKey(call.calledAt));
    if (reunionDayKey(call.calledAt) === todayKey) callsToday++;
    if (call.setterId) setterIds.add(call.setterId);
    if (latestCallComment === undefined && call.notes?.trim()) latestCallComment = call.notes.trim();
    if (nextCallbackAt === undefined && call.nextCallbackAt !== undefined) {
      nextCallbackAt = call.nextCallbackAt;
      callbackSetAt = call.calledAt;
    }
    firstCallAt = firstCallAt === undefined ? call.calledAt : Math.min(firstCallAt, call.calledAt);
  }
  const assignedSetterIds = Array.from(setterIds);
  if (lead.setterId && !assignedSetterIds.includes(lead.setterId)) assignedSetterIds.unshift(lead.setterId);

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
    transferredAt = transferredAt === undefined ? bizCreatedAt(r) : Math.min(transferredAt, bizCreatedAt(r));
    if (r.debriefFilledAt !== undefined) {
      latestDebriefAt = latestDebriefAt === undefined ? r.debriefFilledAt : Math.max(latestDebriefAt, r.debriefFilledAt);
    }
  }

  // Devis (présence + dernier en date).
  const devisRows = (await ctx.db.query("devis").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect())
    .filter((d) => d.deletedAt === undefined);
  const latestDevisAt = devisRows.reduce<number | undefined>(
    (acc, d) => (acc === undefined ? d._creationTime : Math.max(acc, d._creationTime)), undefined);

  // Dossier délivrabilité actif → son statut remplace l'affichage "signé".
  const dossier = (await ctx.db.query("clients").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).collect())
    .find((c) => c.deletedAt === undefined);

  // Historique de stage (premier = arrivée, dernier = ancienneté).
  const stages = await ctx.db
    .query("leadStageHistory")
    .withIndex("by_lead_changedAt", (q) => q.eq("leadId", lead._id))
    .collect();
  let firstStageAt: number | undefined;
  let lastStageAt: number | undefined;
  for (const s of stages) {
    firstStageAt = firstStageAt === undefined ? s.changedAt : Math.min(firstStageAt, s.changedAt);
    lastStageAt = lastStageAt === undefined ? s.changedAt : Math.max(lastStageAt, s.changedAt);
  }

  const latestCallAt = latestCall?.calledAt ?? lead.lastContactAt;
  return {
    ...lead,
    latestCallAt,
    firstCallAt,
    latestCallComment,
    latestCallSetterId: latestCall?.setterId,
    assignedSetterIds,
    callCount: calls.length,
    callsToday,
    nextCallbackAt,
    callbackSetAt,
    joursSansContact: daysSince(latestCallAt, now),
    joursRelance: callDays.size > 0 ? callDays.size : undefined,
    latestRdvAt: latestRdv?.scheduledAt,
    latestRdvStatus: latestRdv?.status,
    latestRdvCommercialId: latestRdv?.commercialId ?? lead.assignedToId,
    transferredAt,
    hasDevis: devisRows.length > 0,
    latestDevisAt,
    hasDebrief: latestDebriefAt !== undefined,
    latestDebriefAt,
    lastStageChangeAt: lastStageAt,
    arrivalAt: firstStageAt ?? bizCreatedAt(lead),
    daysSinceLastStageChange: daysSince(lastStageAt ?? bizCreatedAt(lead), now),
    delivrabiliteStatus: dossier?.statusGlobal,
  };
}
