/**
 * Résolution d'étape via l'API GHL quand le webhook opportunité arrive SANS
 * stage_name (workflow GHL sans le token d'étape dans ses données custom —
 * non modifiable par API, on compense côté serveur). On retrouve
 * l'opportunité du contact puis le NOM de son étape via la définition des
 * pipelines. Best-effort : null si GHL non configuré, contact sans
 * opportunité, ou API en erreur — le webhook retombe alors sur l'erreur de
 * validation d'origine.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { ghlRequest, isGhlConfigured, requireGhlLocationId } from "./ghlClient";

type GhlOpportunity = {
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  updatedAt?: string;
  assignedTo?: string | null;
  monetaryValue?: number;
};

export const resolveStageForContact = internalAction({
  args: { contactId: v.string() },
  handler: async (_ctx, args) => {
    if (!isGhlConfigured()) return null;
    try {
      const locationId = requireGhlLocationId();
      const search = (await ghlRequest("/opportunities/search", {
        query: { location_id: locationId, contact_id: args.contactId, status: "all", limit: 20 },
      })) as { opportunities?: GhlOpportunity[] } | null;
      const opps = search?.opportunities ?? [];
      if (opps.length === 0) return null;
      // La plus récemment mise à jour = l'état courant du contact.
      const best = [...opps].sort(
        (a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""),
      )[0];
      if (!best?.pipelineStageId) return null;
      const pipelines = (await ghlRequest("/opportunities/pipelines", {
        query: { locationId },
      })) as { pipelines?: Array<{ id: string; stages?: Array<{ id: string; name: string }> }> } | null;
      const pipeline = pipelines?.pipelines?.find((p) => p.id === best.pipelineId);
      const stage = pipeline?.stages?.find((s) => s.id === best.pipelineStageId);
      if (!stage) return null;
      return {
        stageName: stage.name,
        ...(best.pipelineId !== undefined ? { pipelineId: best.pipelineId } : {}),
        ...(typeof best.monetaryValue === "number" ? { monetaryValue: best.monetaryValue } : {}),
        ...(typeof best.assignedTo === "string" && best.assignedTo
          ? { assignedUserId: best.assignedTo }
          : {}),
      };
    } catch (err) {
      console.warn(
        `resolveStageForContact(${args.contactId}) échec : ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  },
});
