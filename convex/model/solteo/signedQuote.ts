/**
 * ELE-179 / ELE-175 / ELE-176 — Helpers purs : devis signé Soltéo → plan GHL.
 * Ordre imposé : montant TTC sur l'opportunité PUIS étape « 11. Devis Signé »
 * (le changement d'étape déclenche le Purchase CAPI). Garde-fou : montant > 0.
 */

export type SolteoOffer = {
  id: string;
  status?: string;
  totalPrice?: number | null;
  signedAt?: string | null;
};

export type SolteoProjectDetails = {
  id: string;
  companyId?: string | null;
  externalId?: string | null;
  client?: { id?: string; externalId?: string | null } | null;
  offers?: SolteoOffer[] | null;
};

export function pickSignedOffer(details: SolteoProjectDetails, quoteId?: string): SolteoOffer | null {
  const signed = (details.offers ?? []).filter((o) => o && o.status === "signed");
  if (quoteId) {
    const exact = signed.find((o) => o.id === quoteId);
    if (exact) return exact;
  }
  if (signed.length === 0) return null;
  return [...signed].sort((a, b) => Date.parse(b.signedAt ?? "") - Date.parse(a.signedAt ?? ""))[0] ?? null;
}

export type GhlPipelines = Array<{ id: string; name: string; stages?: Array<{ id: string; name: string }> }>;

export const SALES_PIPELINE_PREFIX = "1. CRM Vente";
export const SIGNED_STAGE_PREFIX = "11.";

export function findSignedStage(pipelines: GhlPipelines): { pipelineId: string; stageId: string } | null {
  const p = pipelines.find((x) => x.name.trim().startsWith(SALES_PIPELINE_PREFIX));
  const s = p?.stages?.find((x) => x.name.trim().startsWith(SIGNED_STAGE_PREFIX));
  return p && s ? { pipelineId: p.id, stageId: s.id } : null;
}

export type GhlOpp = { id: string; pipelineId?: string; pipelineStageId?: string; monetaryValue?: number; status?: string };

export type GhlStep =
  | { op: "set_amount"; opportunityId: string; monetaryValue: number }
  | { op: "move_stage"; opportunityId: string; pipelineId: string; pipelineStageId: string };

export type GhlPlan =
  | { ok: true; steps: GhlStep[]; notes: string[] }
  | { ok: false; reason: "amount_not_positive" | "opportunity_not_found" | "stage_not_found"; notes: string[] };

export function buildGhlPlan(i: {
  totalPriceTtc: number | null | undefined;
  opp: GhlOpp | null;
  target: { pipelineId: string; stageId: string } | null;
}): GhlPlan {
  const notes: string[] = [];
  const ttc = i.totalPriceTtc;
  if (typeof ttc !== "number" || !Number.isFinite(ttc) || ttc <= 0) {
    return { ok: false, reason: "amount_not_positive", notes: [`totalPrice=${String(ttc)}`] };
  }
  if (!i.opp) return { ok: false, reason: "opportunity_not_found", notes };
  if (!i.target) return { ok: false, reason: "stage_not_found", notes };
  const steps: GhlStep[] = [];
  const amount = Math.round(ttc * 100) / 100;
  if (i.opp.monetaryValue !== amount) {
    if (typeof i.opp.monetaryValue === "number" && i.opp.monetaryValue > 0) {
      notes.push(`montant GHL ${i.opp.monetaryValue} ≠ TTC Soltéo ${amount} (Soltéo fait foi)`);
    }
    steps.push({ op: "set_amount", opportunityId: i.opp.id, monetaryValue: amount });
  }
  const inStage = i.opp.pipelineId === i.target.pipelineId && i.opp.pipelineStageId === i.target.stageId;
  if (!inStage) {
    steps.push({
      op: "move_stage", opportunityId: i.opp.id,
      pipelineId: i.target.pipelineId, pipelineStageId: i.target.stageId,
    });
  }
  return { ok: true, steps, notes };
}
