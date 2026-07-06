import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// Statuts qui ferment un closing : on ne réutilise jamais un tel projet.
const CLOSED_PROJECT_STATUSES = ["perdu", "abandonne"] as const;

// Transposition serveur de resolveVenteProject (CommercialLeadPanel.tsx) :
// réutilise le projet ouvert le plus récent du lead (et le marque signe),
// sinon en crée un neuf directement en signe. Idempotent.
export async function ensureProjectForLead(
  ctx: MutationCtx,
  args: { leadId: Id<"leads">; commercialId: Id<"users"> },
): Promise<Id<"projects">> {
  const rows = await ctx.db
    .query("projects")
    .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
    .collect();
  const living = rows
    .filter((p) => p.deletedAt === undefined)
    .sort((a, b) => b._creationTime - a._creationTime);
  const open = living.find(
    (p) => !(CLOSED_PROJECT_STATUSES as readonly string[]).includes(p.status),
  );
  if (open) {
    if (open.status !== "signe") await ctx.db.patch(open._id, { status: "signe" });
    return open._id;
  }

  const lead = await ctx.db.get(args.leadId);
  const name =
    [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Dossier sans nom";
  return await ctx.db.insert("projects", {
    leadId: args.leadId,
    commercialId: args.commercialId,
    name,
    addressLine: lead?.addressLine,
    postalCode: lead?.postalCode,
    city: lead?.city,
    status: "signe",
  });
}

// Marque un projet EXISTANT comme signé (vente). Utilisé quand le débrief est
// créé avec un projectId déjà fourni (le front pré-crée le projet) : sans ça,
// le projet resterait en "qualification" et ne basculerait pas en délivrabilité.
// No-op si le projet est déjà fermé (perdu/abandonné) ou déjà signé.
export async function markProjectSigned(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<void> {
  const project = await ctx.db.get(projectId);
  if (!project || project.deletedAt !== undefined) return;
  if ((CLOSED_PROJECT_STATUSES as readonly string[]).includes(project.status)) return;
  if (project.status !== "signe") await ctx.db.patch(projectId, { status: "signe" });
}
