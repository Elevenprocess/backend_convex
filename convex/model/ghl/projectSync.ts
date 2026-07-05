/**
 * Sync GHL → projet : quand le webhook opportunity fait évoluer leads.status,
 * on calque project.status sur le même état métier (GHL source de vérité).
 * Écrit en direct — ne déclenche PAS de push sortant (pas de boucle d'écho).
 * Portage de ProjectsService.syncFromLeadStatus + createProjectFromSync +
 * triggerDelivrabiliteBootstrap (NestJS).
 *
 * Ces fonctions ÉCRIVENT en base : à appeler depuis des mutations uniquement.
 */
import type { MutationCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import type { LeadStatus, ProjectStatus } from "../enums";
import { ensureDossier } from "../ensureDossier";

// Les statuts amont (nouveau, relance, rdv_pris…) → `qualification` car le
// projet n'est créé que post-débrief : tant que GHL n'a pas atteint l'aval,
// on garde "qualification".
const LEAD_TO_PROJECT_STATUS: Record<LeadStatus, ProjectStatus | null> = {
  nouveau: null,
  qualifie: "qualification",
  rdv_pris: "qualification",
  rdv_honore: "devis_en_cours",
  signature_en_cours: "signature_en_cours",
  signe: "signe",
  perdu: "perdu",
  relance: null,
  pas_qualifie: "perdu",
  a_rappeler: null,
  pas_de_reponse: null,
};

export function mapLeadStatusToProjectStatus(status: LeadStatus): ProjectStatus | null {
  return LEAD_TO_PROJECT_STATUS[status];
}

export async function syncProjectFromLeadStatus(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  leadStatus: LeadStatus,
): Promise<void> {
  const targetStatus = mapLeadStatusToProjectStatus(leadStatus);
  if (!targetStatus) return;

  const all = await ctx.db
    .query("projects")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  const existing = all.filter((p) => p.deletedAt === undefined);
  const openProject =
    existing.find(
      (p) => p.status !== "signe" && p.status !== "perdu" && p.status !== "abandonne",
    ) ?? existing[0];

  if (!openProject) {
    await createProjectFromSync(ctx, leadId, targetStatus);
    return;
  }
  if (openProject.status === targetStatus) return;

  await ctx.db.patch(openProject._id, { status: targetStatus });

  // Le sync GHL → SaaS qui amène le projet à 'signe' déclenche le bootstrap
  // délivrabilité comme un PATCH manuel.
  if (targetStatus === "signe" && openProject.status !== "signe") {
    await bootstrapDelivrabilite(ctx, { ...openProject, status: "signe" });
  }
}

/**
 * Crée un projet au statut cible quand l'entrant GHL touche un lead sans
 * projet (ex : No-Show → perdu). commercialId est requis au schéma : sans
 * commercial assigné on skippe en loggant (parité NestJS).
 */
async function createProjectFromSync(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  targetStatus: ProjectStatus,
): Promise<void> {
  const lead = await ctx.db.get(leadId);
  if (!lead?.assignedToId) {
    console.warn(
      `[GHL sync] Lead ${leadId} sans commercial assigné — projet "${targetStatus}" non créé.`,
    );
    return;
  }
  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "Dossier sans nom";
  const projectId = await ctx.db.insert("projects", {
    leadId,
    commercialId: lead.assignedToId,
    name,
    ...(lead.addressLine !== undefined ? { addressLine: lead.addressLine } : {}),
    ...(lead.postalCode !== undefined ? { postalCode: lead.postalCode } : {}),
    ...(lead.city !== undefined ? { city: lead.city } : {}),
    status: targetStatus,
  });
  if (targetStatus === "signe") {
    const created = await ctx.db.get(projectId);
    if (created) await bootstrapDelivrabilite(ctx, created);
  }
}

/**
 * Bootstrap délivrabilité depuis un projet signé : enrichit le dossier avec
 * le devis signé le plus récent (montantNet prioritaire), sinon le dernier
 * débrief vente. Best-effort : une erreur est avalée et loggée.
 */
async function bootstrapDelivrabilite(
  ctx: MutationCtx,
  project: Doc<"projects">,
): Promise<void> {
  try {
    const devisRows = await ctx.db
      .query("devis")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const signedDevis = devisRows
      .filter((d) => d.status === "signe" && d.deletedAt === undefined)
      .sort((a, b) => (b.signedAt ?? 0) - (a.signedAt ?? 0))[0];

    const debriefRows = await ctx.db
      .query("debriefs")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const venteDebrief = debriefRows
      .filter((d) => d.outcome === "vente" && d.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime)[0];

    const montantTotal =
      signedDevis?.montantNet ?? signedDevis?.montantTtc ?? venteDebrief?.montantTotal;
    const typeFinancement = signedDevis?.financingType ?? venteDebrief?.financingType;

    await ensureDossier(ctx, {
      leadId: project.leadId,
      projectId: project._id,
      ...(montantTotal !== undefined ? { montantTotal } : {}),
      ...(typeFinancement != null ? { typeFinancement } : {}),
      ...(signedDevis?.signedAt !== undefined ? { signedAt: signedDevis.signedAt } : {}),
    });
  } catch (err) {
    console.error(
      `Bootstrap délivrabilité failed for project ${project._id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
