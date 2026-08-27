/**
 * Sélection PURE des opportunités GHL à traiter comme « retour aux setters » :
 * l'étape en contient des centaines (stock ancien, souvent abandonné) — on ne
 * remonte que celles entrées dans l'étape récemment (fenêtre glissante), avec
 * un contact identifiable. La déduplication définitive (déjà appliqué ?) se
 * fait côté DB via l'historique d'étapes (lead, stage, lastStageChangeAt).
 */

export type GhlOpportunityRow = {
  id?: string;
  contactId?: string | null;
  contact?: { id?: string; name?: string | null; email?: string | null; phone?: string | null } | null;
  name?: string | null;
  status?: string | null;
  assignedTo?: string | null;
  monetaryValue?: number | null;
  pipelineId?: string | null;
  lastStageChangeAt?: string | null;
  updatedAt?: string | null;
};

export type RetourCandidate = {
  contactId: string;
  occurredAt: number;
  ghlAssignedUserId?: string;
  monetaryValue?: number;
  ghlPipelineId?: string;
  contactSeed: { firstName?: string; lastName?: string; email?: string; phone?: string };
};

export const DEFAULT_RETOUR_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** « Jean Payet » → { firstName: "Jean", lastName: "Payet" } ; un seul mot → prénom. */
export function splitContactName(name?: string | null): { firstName?: string; lastName?: string } {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return {};
  const idx = clean.indexOf(" ");
  if (idx < 0) return { firstName: clean };
  return { firstName: clean.slice(0, idx), lastName: clean.slice(idx + 1) };
}

export function pickRetourCandidates(
  rows: GhlOpportunityRow[],
  now: number,
  windowMs: number = DEFAULT_RETOUR_WINDOW_MS,
): RetourCandidate[] {
  const out: RetourCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const contactId = row.contact?.id || row.contactId || undefined;
    if (!contactId) continue;
    const at = Date.parse(row.lastStageChangeAt ?? row.updatedAt ?? "");
    if (!Number.isFinite(at)) continue;
    if (at < now - windowMs || at > now + 60_000) continue;
    // Un contact peut porter plusieurs opportunités dans l'étape : la plus récente gagne.
    if (seen.has(contactId)) continue;
    seen.add(contactId);
    const seedName = splitContactName(row.contact?.name ?? row.name);
    out.push({
      contactId,
      occurredAt: at,
      ...(row.assignedTo ? { ghlAssignedUserId: row.assignedTo } : {}),
      ...(typeof row.monetaryValue === "number" ? { monetaryValue: row.monetaryValue } : {}),
      ...(row.pipelineId ? { ghlPipelineId: row.pipelineId } : {}),
      contactSeed: {
        ...seedName,
        ...(row.contact?.email ? { email: row.contact.email } : {}),
        ...(row.contact?.phone ? { phone: row.contact.phone } : {}),
      },
    });
  }
  return out.sort((a, b) => a.occurredAt - b.occurredAt);
}
