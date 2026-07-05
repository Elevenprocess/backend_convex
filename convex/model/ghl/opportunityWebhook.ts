/**
 * Normalisation des payloads "Opportunity Created / Stage Changed / Status
 * Changed" GHL (pipeline "1. CRM Vente 📊"). GHL laisse composer le JSON
 * librement dans le builder → alias camel/snake acceptés. contact_id et
 * stage_name sont les deux seuls champs strictement requis.
 *
 * Portage NestJS (dto/ghl-opportunity-webhook.dto.ts) sans zod ; occurredAt
 * en ms ; nowMs injecté (fonction PURE).
 */

const pick = (...values: unknown[]): string | undefined => {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
};

const pickNumber = (...values: unknown[]): number | undefined => {
  for (const v of values) {
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const parseDateMs = (value: string | undefined, nowMs: number): number => {
  if (!value) return nowMs;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : nowMs;
};

export class GhlOpportunityWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhlOpportunityWebhookValidationError";
  }
}

export interface NormalizedOpportunityEvent {
  event: string;
  externalId: string;
  ghlStageName: string;
  ghlPipelineId?: string;
  status?: string;
  monetaryValue?: number;
  ghlAssignedUserId?: string;
  lostReason?: string;
  occurredAt: number;
  contactSeed: { firstName?: string; lastName?: string; email?: string; phone?: string };
}

/**
 * Extrait et normalise les champs nécessaires à applyGhlStageChange. Jette
 * une erreur explicite si contact_id ou stage_name sont absents.
 */
export function normalizeOpportunityWebhook(
  p: Record<string, unknown>,
  nowMs: number,
): NormalizedOpportunityEvent {
  const externalId = pick(p.contact_id, p.contactId);
  if (!externalId) {
    throw new GhlOpportunityWebhookValidationError("contact_id manquant dans le payload");
  }
  const ghlStageName = pick(p.stage_name, p.stageName, p.pipeline_stage, p.pipelineStage);
  if (!ghlStageName) {
    throw new GhlOpportunityWebhookValidationError("stage_name manquant dans le payload");
  }

  return {
    event: pick(p.event) ?? "opportunity.changed",
    externalId,
    ghlStageName,
    ghlPipelineId: pick(p.pipeline_id, p.pipelineId),
    status: pick(p.status),
    monetaryValue: pickNumber(p.monetary_value, p.monetaryValue),
    ghlAssignedUserId: pick(p.assigned_user_id, p.assignedUserId, p.assigned_to, p.assignedTo),
    lostReason: pick(p.lost_reason, p.lostReason, p.lost_reason_name),
    occurredAt: parseDateMs(
      pick(p.occurred_at, p.occurredAt, p.updated_at, p.updatedAt),
      nowMs,
    ),
    contactSeed: {
      firstName: pick(p.first_name, p.firstName),
      lastName: pick(p.last_name, p.lastName),
      email: pick(p.email),
      phone: pick(p.phone),
    },
  };
}
