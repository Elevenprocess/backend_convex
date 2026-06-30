import { MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { LeadStatus, ProjectStatus } from "./enums";

// Portage verbatim de DevisService.syncStatusToLeadAndProject.
// Le devis est source de vérité commerciale ; pas d'override inverse.
export async function syncStatusToLeadAndProject(
  ctx: MutationCtx,
  devisRow: Doc<"devis">,
): Promise<void> {
  const ds = devisRow.status;
  let leadStatus: LeadStatus | null = null;
  let projectStatus: ProjectStatus | null = null;
  if (ds === "signe") {
    leadStatus = "signe"; projectStatus = "signe";
  } else if (ds === "signature_en_cours") {
    leadStatus = "signature_en_cours"; projectStatus = "signature_en_cours";
  } else if (ds === "perdu") {
    leadStatus = "perdu"; projectStatus = "perdu";
  } else if (ds === "en_attente") {
    projectStatus = "devis_en_cours"; // lead inchangé
  }

  if (leadStatus && devisRow.leadId) {
    await ctx.db.patch(devisRow.leadId, { status: leadStatus });
  }
  if (projectStatus && devisRow.projectId) {
    await ctx.db.patch(devisRow.projectId, { status: projectStatus });
  }
}
