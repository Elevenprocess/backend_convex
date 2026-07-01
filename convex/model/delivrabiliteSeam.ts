import { QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { EcheanceJalon } from "./enums";

// SEAM DÉLIVRABILITÉ — tranche délivrabilité câblera les vraies lectures.
// TODO(délivrabilité): lire workflowSubsteps par dossier + key + status==='fait'.
export async function isJalonReached(
  _ctx: QueryCtx,
  args: { projectId?: Id<"projects">; leadId?: Id<"leads">; jalonKey: EcheanceJalon | null },
): Promise<boolean> {
  if (args.jalonKey === "signature") return true;
  // Table workflowSubsteps non déclarée → aucun jalon franchi pour l'instant.
  return false;
}

// TODO(délivrabilité): lire clients.statusGlobal par projet/lead.
export async function clientStatusGlobal(
  _ctx: QueryCtx,
  _args: { projectId?: Id<"projects">; leadId?: Id<"leads"> },
): Promise<string | null> {
  return null;
}
