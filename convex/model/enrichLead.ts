// Enrichissement read-side d'un lead — portage de LeadsService.withLatestCalls
// (appels, RDV, devis, débrief, dossier délivrabilité, compteurs dérivés). Le
// `jauge11Jours` (Airtable) est hors périmètre Convex. `now` est fourni par
// l'appelant (queries déterministes). Réunion = UTC+4 sans DST.
//
// Depuis le refactor agg (coût Convex) : les agrégats sont lus depuis
// `lead.agg` (dénormalisé, maintenu à l'écriture — cf. model/leadAgg.ts) et
// seuls les champs dépendants de `now` sont dérivés ici. Un lead sans agg à
// jour (pas encore backfillé, ou AGG_VERSION bumpée) retombe sur le calcul
// live d'origine via computeLeadAgg — même résultat, juste plus de lectures.
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AGG_VERSION, computeLeadAgg, reunionDayKey, type LeadAgg } from "./leadAgg";

const DAY_MS = 86_400_000;

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

/** Projection pure agg + doc lead + now → lead enrichi. Les champs susceptibles
 * de changer par simple patch du lead (setterId, assignedToId, lastContactAt)
 * sont fusionnés ici, jamais figés dans l'agg. */
export function enrichFromAgg(lead: Doc<"leads">, agg: LeadAgg, now: number): EnrichedLead {
  const todayKey = reunionDayKey(now);

  const assignedSetterIds = [...agg.callSetterIds];
  if (lead.setterId && !assignedSetterIds.includes(lead.setterId)) assignedSetterIds.unshift(lead.setterId);

  const latestCallAt = agg.latestCallAt ?? lead.lastContactAt;
  const { v, updatedAt, callSetterIds, lastCallDayKey, callsOnLastCallDay, distinctCallDays, firstStageAt, ...kept } = agg;
  void v; void updatedAt; void callSetterIds;
  const { agg: _agg, ...leadFields } = lead;
  void _agg;
  return {
    ...leadFields,
    ...kept,
    latestCallAt,
    assignedSetterIds,
    callsToday: lastCallDayKey === todayKey ? callsOnLastCallDay : 0,
    joursSansContact: daysSince(latestCallAt, now),
    joursRelance: distinctCallDays > 0 ? distinctCallDays : undefined,
    latestRdvCommercialId: agg.latestRdvCommercialId ?? lead.assignedToId,
    hasDebrief: agg.latestDebriefAt !== undefined,
    arrivalAt: firstStageAt ?? bizCreatedAt(lead),
    daysSinceLastStageChange: daysSince(agg.lastStageChangeAt ?? bizCreatedAt(lead), now),
  };
}

export async function enrichLead(
  ctx: QueryCtx,
  lead: Doc<"leads">,
  now: number,
): Promise<EnrichedLead> {
  const agg = lead.agg && lead.agg.v === AGG_VERSION ? lead.agg : await computeLeadAgg(ctx, lead);
  return enrichFromAgg(lead, agg, now);
}
