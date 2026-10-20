/**
 * ELE-179 — Normalisation tolérante du webhook Soltéo. Le format exact du
 * corps n'est pas documenté publiquement : on accepte eventType|event|type,
 * eventDateTime|date|createdAt, et les ids dans `details` ou à la racine.
 */
export type SolteoWebhook = {
  eventType: string;
  eventDateTime?: string;
  companyId?: string;
  projectId?: string;
  quoteId?: string;
  externalProjectId?: string;
  dedupeKey: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function normalizeSolteoWebhook(body: unknown): SolteoWebhook {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const details = (root.details && typeof root.details === "object" ? root.details : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const val = str(details[k]) ?? str(root[k]);
      if (val) return val;
    }
    return undefined;
  };
  const eventType = str(root.eventType) ?? str(root.event) ?? str(root.type) ?? "unknown";
  const eventDateTime = str(root.eventDateTime) ?? str(root.date) ?? str(root.createdAt);
  const projectId = pick("projectId");
  const quoteId = pick("quoteId");
  const entityId = quoteId ?? projectId ?? pick("clientId", "leadId", "reportId", "id") ?? "";
  const out: SolteoWebhook = {
    eventType,
    dedupeKey: `${eventType}:${entityId}:${eventDateTime ?? ""}`,
  };
  if (eventDateTime) out.eventDateTime = eventDateTime;
  const companyId = pick("companyId");
  if (companyId) out.companyId = companyId;
  if (projectId) out.projectId = projectId;
  if (quoteId) out.quoteId = quoteId;
  const ext = pick("externalProjectId");
  if (ext) out.externalProjectId = ext;
  return out;
}

/** Événements qui méritent une relecture du projet (les autres sont ignorés proprement). */
export function solteoEventNeedsProjectRead(eventType: string): boolean {
  return eventType === "quote_signed";
}
