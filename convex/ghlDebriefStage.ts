/**
 * Débrief « suivi prévu / en réflexion » → opportunité GHL déplacée de
 * « RDV Planifié » vers « (BIS) Retour aux Setters 🔙 » (demande user 28/09 :
 * GHL restait sur « RDV Planifié » alors que Velora avait le lead à relancer).
 * Le cron ghl-retour-setters-sync (15 min) rapatrie ensuite ce passage côté
 * Velora (marqueur retourSetters → onglet « Relance court terme », notif setter).
 * Best-effort, jamais bloquant. Voir model/ghl/debriefStage.ts pour les règles.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { ghlRequest, isGhlConfigured } from "./ghlClient";
import { findOpportunityForContact, listPipelines, normalizeText } from "./ghlAppointments";
import { debriefTargetStage, isStaleRdvStage } from "./model/ghl/debriefStage";
import { RETOUR_SETTERS_STAGE } from "./model/ghl/stageMapper";

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}/;

export const stageData = internalQuery({
  args: { debriefId: v.id("debriefs") },
  handler: async (ctx, args) => {
    const d = await ctx.db.get(args.debriefId);
    if (!d || d.deletedAt !== undefined) return null;
    let leadId = d.leadId;
    if (!leadId && d.projectId) leadId = (await ctx.db.get(d.projectId))?.leadId;
    if (!leadId) return null;
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    const contactId = lead.ghlContactId ?? lead.externalId;
    if (!contactId || UUID_PREFIX.test(contactId)) return null;
    // Seul le débrief le plus récent du lead décide (modifier un vieux débrief
    // ne doit pas renvoyer aux setters un lead passé à autre chose).
    const latest = (await ctx.db.query("debriefs").withIndex("by_lead", (q) => q.eq("leadId", leadId)).collect())
      .filter((x) => x.deletedAt === undefined)
      .sort((a, b) => (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime))[0];
    if (latest && latest._id !== d._id) return null;
    return { contactId, targetStage: debriefTargetStage(d.outcome, d.nonSaleReason ?? null) };
  },
});

type MoveResult = { contactId: string; from: string | null; moved: boolean; reason: string };

async function moveStaleRdvToStage(contactId: string, targetStage: string, dryRun: boolean): Promise<MoveResult> {
  const opp = await findOpportunityForContact(contactId);
  if (!opp) return { contactId, from: null, moved: false, reason: "pas d'opportunité CRM Vente" };
  const pipeline = (await listPipelines()).find((p) => p.id === opp.pipelineId);
  const from = pipeline?.stages.find((s) => s.id === opp.pipelineStageId)?.name ?? null;
  if (!isStaleRdvStage(from)) return { contactId, from, moved: false, reason: "étape posée par un humain, inchangée" };
  const target = pipeline?.stages.find((s) => normalizeText(s.name) === normalizeText(targetStage));
  if (!target) return { contactId, from, moved: false, reason: `étape « ${targetStage} » introuvable` };
  if (dryRun) return { contactId, from, moved: false, reason: "dry-run" };
  const updated = (await ghlRequest(`/opportunities/${encodeURIComponent(opp.id)}`, {
    method: "PUT",
    body: { pipelineStageId: target.id },
  })) as { opportunity?: unknown } | null;
  return { contactId, from, moved: Boolean(updated?.opportunity), reason: updated?.opportunity ? "déplacée" : "réponse GHL vide" };
}

export const moveAfterDebrief = internalAction({
  args: { debriefId: v.id("debriefs") },
  handler: async (ctx, args): Promise<MoveResult | null> => {
    if (!isGhlConfigured()) return null;
    const data = await ctx.runQuery(internal.ghlDebriefStage.stageData, { debriefId: args.debriefId });
    if (!data?.targetStage) return null;
    try {
      const res = await moveStaleRdvToStage(data.contactId, data.targetStage, false);
      console.log(`Débrief ${args.debriefId} → GHL ${res.from ?? "?"} → ${data.targetStage} : ${res.reason}`);
      return res;
    } catch (err) {
      console.warn(`Déplacement GHL après débrief échoué (${args.debriefId}) : ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },
});

/** Rattrapage ciblé : `npx convex run ghlDebriefStage:moveContactsToRetour '{"contactIds":[…],"dryRun":true}'`.
 *  Ne déplace que les opportunités encore sur « RDV Planifié / Reprogrammé ». */
export const moveContactsToRetour = internalAction({
  args: { contactIds: v.array(v.string()), dryRun: v.optional(v.boolean()) },
  handler: async (_ctx, args): Promise<MoveResult[]> => {
    if (!isGhlConfigured()) return [];
    const out: MoveResult[] = [];
    for (const id of args.contactIds) {
      try {
        out.push(await moveStaleRdvToStage(id, RETOUR_SETTERS_STAGE, args.dryRun ?? true));
      } catch (err) {
        out.push({ contactId: id, from: null, moved: false, reason: `erreur : ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return out;
  },
});
