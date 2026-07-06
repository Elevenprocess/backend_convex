/**
 * Dossiers délivrabilité (table clients) — queries de lecture.
 * Portage de ClientsController/ClientsService (NestJS), périmètre 6a :
 * list / getByProject / getByLead. Décor riche (missingDocs, gating,
 * currentStep détaillé) différé en 6b/6d.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  clientStatusValidator,
  workflowPhaseValidator,
  financingTypeValidator,
  type DocumentType,
  type Role,
} from "./model/enums";
import { countMissingDocs } from "./model/substepGating";
import { requireRole } from "./model/access";
import { ensureDossier, recomputeClientStatus } from "./model/ensureDossier";
import { can, normalizeRole } from "./model/delivrabilitePermissions";
import { newlyAddedTechs, pickVtDate, pickVtHeure, inPeriod } from "./model/vtCalendar";
import { vtAssignedMessage } from "./model/notifMessages";
import { createNotification } from "./model/notify";

// ─── Rôles (portés de roles.decorator.ts + clients.controller.ts) ────────────

/** Équipe ops/délivrabilité (le rôle `delivrabilite` est deprecated mais conservé). */
export const DELIVRABILITE_ROLES: Role[] = [
  "delivrabilite",
  "responsable_technique",
  "back_office",
];

/** Écriture workflow : admin + délivrabilité + technicien. */
export const WORKFLOW_ROLES: Role[] = [
  "admin",
  ...DELIVRABILITE_ROLES,
  "technicien",
];

/** Lecture élargie : + finances et commerciaux (suivi de leurs clients signés). */
export const WORKFLOW_VIEW_ROLES: Role[] = [
  ...WORKFLOW_ROLES,
  "finances",
  "commercial",
  "commercial_lead",
];

/** Initialisation d'un dossier : écriture du module, hors technicien. */
export const BOOTSTRAP_ROLES: Role[] = ["admin", ...DELIVRABILITE_ROLES];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isActive(c: Doc<"clients">): boolean {
  return c.deletedAt === undefined;
}

async function findActiveByProject(
  ctx: QueryCtx,
  projectId: Doc<"projects">["_id"],
): Promise<Doc<"clients"> | null> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return rows.find(isActive) ?? null;
}

async function findActiveByLead(
  ctx: QueryCtx,
  leadId: Doc<"leads">["_id"],
): Promise<Doc<"clients"> | null> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();
  return rows.find(isActive) ?? null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    const dossier = await findActiveByProject(ctx, args.projectId);
    if (!dossier) return null;
    // Même périmètre que list : null hors scope, sans fuite d'existence.
    const visible = await listVisibleClientIds(ctx, user);
    if (visible !== null && !visible.has(dossier._id)) return null;
    return await decorateClient(ctx, dossier);
  },
});

export const getByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    const dossier = await findActiveByLead(ctx, args.leadId);
    if (!dossier) return null;
    // Même périmètre que list : null hors scope, sans fuite d'existence.
    const visible = await listVisibleClientIds(ctx, user);
    if (visible !== null && !visible.has(dossier._id)) return null;
    return await decorateClient(ctx, dossier);
  },
});

export const list = query({
  args: {
    leadId: v.optional(v.id("leads")),
    projectId: v.optional(v.id("projects")),
    phase: v.optional(workflowPhaseValidator),
    statusGlobal: v.optional(clientStatusValidator),
    blocked: v.optional(v.boolean()),
    technicienVtId: v.optional(v.id("users")),
    unassignedVt: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);

    // Choisir l'index le plus sélectif disponible, filtrer le reste en mémoire.
    let rows: Doc<"clients">[];
    if (args.projectId !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .collect();
    } else if (args.leadId !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_lead", (q) => q.eq("leadId", args.leadId!))
        .collect();
    } else if (args.statusGlobal !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_status", (q) => q.eq("statusGlobal", args.statusGlobal!))
        .collect();
    } else if (args.phase !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_phase", (q) => q.eq("currentPhase", args.phase!))
        .collect();
    } else if (args.blocked !== undefined) {
      rows = await ctx.db
        .query("clients")
        .withIndex("by_blocked", (q) => q.eq("blocked", args.blocked!))
        .collect();
    } else {
      rows = await ctx.db.query("clients").collect();
    }

    // Scoping serveur (les filtres query ne peuvent qu'affiner, jamais élargir).
    const visible = await listVisibleClientIds(ctx, user);
    const scoped = rows
      .filter(isActive)
      .filter((c) => visible === null || visible.has(c._id))
      .filter((c) => args.statusGlobal === undefined || c.statusGlobal === args.statusGlobal)
      .filter((c) => args.phase === undefined || c.currentPhase === args.phase)
      .filter((c) => args.blocked === undefined || c.blocked === args.blocked)
      .filter((c) => args.technicienVtId === undefined || c.technicienVtId === args.technicienVtId)
      .filter((c) => !args.unassignedVt || c.technicienVtId === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(scoped.map((c) => decorateClient(ctx, c)));
  },
});

/**
 * Dossiers visibles pour clients.list/vtCalendar (parité ClientsService.list) :
 * technicien → VT attribuée (scalaire) OU responsable d'une étape installation ;
 * commercial (pas commercial_lead) → dossiers de SES leads. null = tout voir.
 * Périmètre volontairement plus restreint que visibleClientIds (steps/substeps).
 */
async function listVisibleClientIds(
  ctx: QueryCtx,
  user: Doc<"users">,
): Promise<Set<Id<"clients">> | null> {
  const role = user.role ?? "setter";
  if (normalizeRole(role) === "technicien") {
    const out = new Set<Id<"clients">>();
    const all = await ctx.db.query("clients").collect();
    for (const c of all) {
      if (c.deletedAt === undefined && c.technicienVtId === user._id) out.add(c._id);
    }
    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_responsable", (q) => q.eq("responsableId", user._id))
      .collect();
    for (const s of steps) if (s.phase === "installation") out.add(s.clientId);
    return out;
  }
  if (role === "commercial") {
    const out = new Set<Id<"clients">>();
    const all = await ctx.db.query("clients").collect();
    for (const c of all) {
      if (c.deletedAt !== undefined) continue;
      const lead = await ctx.db.get(c.leadId);
      if (lead?.assignedToId === user._id) out.add(c._id);
    }
    return out;
  }
  return null;
}

/**
 * Nombre de sous-étapes du dossier dont au moins une pièce attendue manque.
 * Requête documents directe (pas d'import de documents.ts : il importe clients.ts).
 */
async function missingDocsOf(ctx: QueryCtx, clientId: Id<"clients">): Promise<number> {
  const subs = await ctx.db
    .query("workflowSubsteps")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  const docTypesBySubstep = new Map<string, DocumentType[]>();
  for (const s of subs) {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_substep", (q) => q.eq("workflowSubstepId", s._id))
      .collect();
    docTypesBySubstep.set(
      s._id,
      docs.filter((d) => d.deletedAt === undefined).map((d) => d.type),
    );
  }
  return countMissingDocs(
    subs.map((s) => ({ id: s._id, key: s.key })),
    docTypesBySubstep,
  );
}

/**
 * Carte des étapes par phase (parité ClientResponse.steps du NestJS) : une
 * entrée workflowSteps par phase → { status, dates, problème, responsable }.
 */
async function stepsMapOf(
  ctx: QueryCtx,
  clientId: Id<"clients">,
): Promise<Record<string, {
  status: string;
  datePlanifiee: string | null;
  dateRealisee: string | null;
  problemReason: string | null;
  responsableId: string | null;
}>> {
  const steps = await ctx.db
    .query("workflowSteps")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  const out: Record<string, {
    status: string;
    datePlanifiee: string | null;
    dateRealisee: string | null;
    problemReason: string | null;
    responsableId: string | null;
  }> = {};
  for (const s of steps) {
    out[s.phase] = {
      status: s.status,
      datePlanifiee: s.datePlanifiee ?? null,
      dateRealisee: s.dateRealisee ?? null,
      problemReason: s.problemReason ?? null,
      responsableId: s.responsableId ?? null,
    };
  }
  return out;
}

/** Décor lead minimal pour les cartes (parité ClientResponse.lead). */
async function leadDecorOf(
  ctx: QueryCtx,
  leadId: Id<"leads">,
): Promise<{ fullName: string | null; city: string | null; phone: string | null }> {
  const lead = await ctx.db.get(leadId);
  const fullName =
    [lead?.firstName, lead?.lastName].filter((s) => s && s.trim()).join(" ").trim() || null;
  return { fullName, city: lead?.city ?? null, phone: lead?.phone ?? null };
}

/** Décor commun des trois lectures de dossier (list/getByProject/getByLead). */
async function decorateClient(ctx: QueryCtx, c: Doc<"clients">) {
  return {
    ...c,
    techniciens: await techniciensOf(ctx, c._id),
    missingDocs: await missingDocsOf(ctx, c._id),
    steps: await stepsMapOf(ctx, c._id),
    lead: await leadDecorOf(ctx, c.leadId),
  };
}

/** Techniciens de la jonction, avec noms (ordre d'insertion). */
export async function techniciensOf(
  ctx: QueryCtx,
  clientId: Id<"clients">,
): Promise<Array<{ id: Id<"users">; name: string }>> {
  const rows = await ctx.db
    .query("vtTechniciens")
    .withIndex("by_client", (q) => q.eq("clientId", clientId))
    .collect();
  const out: Array<{ id: Id<"users">; name: string }> = [];
  for (const r of rows) {
    const u = await ctx.db.get(r.userId);
    out.push({ id: r.userId, name: u?.name ?? "" });
  }
  return out;
}

// Rôles voyant TOUTES les interventions des dossiers visibles (rôle brut, parité NestJS).
const PRIVILEGED_CALENDAR_ROLES = new Set([
  "admin",
  "delivrabilite",
  "responsable_technique",
  "back_office",
]);

/**
 * Calendrier VT + installations (portage GET /clients/vt-calendar).
 * Une entrée 'vt' par dossier avec date (priorité vt_planifie, repli
 * vt_attribuee) ; une entrée 'installation' par datePlanifiee de la phase,
 * visible seulement des privilégiés, du responsable de l'étape ou du pose
 * team lead (un technicien ne voit pas la pose d'un autre tech sur un
 * dossier visible via sa VT).
 */
export const vtCalendar = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    const visible = await listVisibleClientIds(ctx, user);
    const all = (await ctx.db.query("clients").collect())
      .filter(isActive)
      .filter((c) => visible === null || visible.has(c._id));
    if (all.length === 0) return [];

    const isPrivileged = PRIVILEGED_CALENDAR_ROLES.has(user.role ?? "setter");
    const entries: Array<Record<string, unknown>> = [];

    for (const c of all) {
      const lead = await ctx.db.get(c.leadId);
      const project = c.projectId ? await ctx.db.get(c.projectId) : null;
      const steps = await ctx.db
        .query("workflowSteps")
        .withIndex("by_client", (q) => q.eq("clientId", c._id))
        .collect();
      const vtStep = steps.find((s) => s.phase === "vt");
      const installStep = steps.find((s) => s.phase === "installation");
      const subs = await ctx.db
        .query("workflowSubsteps")
        .withIndex("by_client", (q) => q.eq("clientId", c._id))
        .collect();
      const subByKey = new Map(subs.map((s) => [s.key as string, s]));
      const heureOf = (key: string) => {
        const h = subByKey.get(key)?.heure;
        return h ? h.slice(0, 5) : null;
      };
      const dateOf = (key: string) => subByKey.get(key)?.dateRealisee ?? null;

      const common = {
        clientId: c._id,
        leadId: c.leadId,
        leadName: [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Client",
        projectName: project?.name ?? null,
        city: lead?.city ?? null,
        phone: lead?.phone ?? null,
        technicienVtId: c.technicienVtId ?? null,
        techniciens: await techniciensOf(ctx, c._id),
        notes: null,
      };

      // ── VT : date + heure issues des sous-étapes vt_planifie / vt_attribuee ──
      const vtDate = pickVtDate({
        vt_planifie: dateOf("vt_planifie"),
        vt_attribuee: dateOf("vt_attribuee"),
      });
      const vtHeure = pickVtHeure({
        vt_planifie: heureOf("vt_planifie"),
        vt_attribuee: heureOf("vt_attribuee"),
      });
      if (vtDate && inPeriod(vtDate, args.from, args.to)) {
        entries.push({
          ...common,
          kind: "vt",
          date: vtDate.slice(0, 10),
          heure: vtHeure,
          status: vtStep?.status ?? "a_faire",
          technicienId: c.technicienVtId ?? null,
        });
      }

      // ── Installation : date planifiée de la phase 'installation' ──
      const installDate = installStep?.datePlanifiee ?? null;
      const installVisible =
        isPrivileged || installStep?.responsableId === user._id || c.poseTeamLeadId === user._id;
      if (installDate && inPeriod(installDate, args.from, args.to) && installVisible) {
        entries.push({
          ...common,
          kind: "installation",
          date: installDate.slice(0, 10),
          heure: heureOf("install_a_faire"),
          status: installStep?.status ?? "a_faire",
          technicienId: installStep?.responsableId ?? c.poseTeamLeadId ?? null,
        });
      }
    }
    return entries;
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Attribution multi-techniciens VT (portage PATCH /clients/:id).
 * `technicienVtIds` prioritaire ; repli sur le scalaire `technicienVtId` ;
 * set vide = désassignation. Le scalaire clients.technicienVtId = premier du
 * set (rétro-compat, pilote le scoping steps/substeps). Notifie uniquement
 * les techniciens NOUVELLEMENT assignés.
 */
export const assignTechniciens = mutation({
  args: {
    clientId: v.id("clients"),
    technicienVtIds: v.optional(v.array(v.id("users"))),
    technicienVtId: v.optional(v.union(v.null(), v.id("users"))),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, WORKFLOW_VIEW_ROLES);
    if (!can(user.role ?? "setter", "assign")) {
      throw new Error(`Rôle ${user.role} non autorisé à attribuer un technicien`);
    }
    const existing = await ctx.db.get(args.clientId);
    if (!existing || existing.deletedAt !== undefined) {
      throw new Error(`Client ${args.clientId} introuvable`);
    }

    // Normalisation : liste prioritaire, repli scalaire, sinon désassignation.
    const nextIds =
      args.technicienVtIds && args.technicienVtIds.length > 0
        ? args.technicienVtIds
        : args.technicienVtId
          ? [args.technicienVtId]
          : [];
    const primaryTechId = nextIds[0];

    // Remplacement complet du set (seule écriture de la jonction → unicité garantie).
    const currentRows = await ctx.db
      .query("vtTechniciens")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    const previousIds = currentRows.map((r) => r.userId as string);
    for (const r of currentRows) await ctx.db.delete(r._id);
    for (const userId of nextIds) {
      await ctx.db.insert("vtTechniciens", { clientId: args.clientId, userId });
    }
    await ctx.db.patch(args.clientId, { technicienVtId: primaryTechId ?? undefined });

    await recomputeClientStatus(ctx, args.clientId);

    // Notifie chaque technicien NOUVELLEMENT assigné (best-effort).
    const newTechs = newlyAddedTechs(previousIds, nextIds as string[]);
    if (newTechs.length > 0) {
      const lead = await ctx.db.get(existing.leadId);
      const leadName =
        [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "Client";
      const { title, body } = vtAssignedMessage({ leadName, city: lead?.city ?? null });
      for (const userId of newTechs) {
        await createNotification(ctx, {
          userId: userId as Id<"users">,
          type: "vt_assigned",
          title,
          body,
          payload: { clientId: args.clientId, leadId: existing.leadId },
        });
      }
    }

    const updated = (await ctx.db.get(args.clientId))!;
    return { ...updated, techniciens: await techniciensOf(ctx, args.clientId) };
  },
});

/**
 * Initialisation manuelle d'un dossier délivrabilité (portage de
 * POST /clients/bootstrap). projectId fourni → dossier scopé au projet
 * (leadId résolu depuis le projet) ; sinon dossier legacy scopé au lead.
 * Idempotent via ensureDossier.
 */
export const bootstrap = mutation({
  args: {
    leadId: v.optional(v.id("leads")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, BOOTSTRAP_ROLES);

    if (args.leadId === undefined && args.projectId === undefined) {
      throw new Error("leadId ou projectId requis");
    }

    let leadId = args.leadId;
    if (args.projectId !== undefined) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.deletedAt !== undefined) {
        throw new Error(`Projet ${args.projectId} introuvable`);
      }
      leadId = leadId ?? project.leadId;
    }

    const lead = await ctx.db.get(leadId!);
    if (!lead || lead.deletedAt !== undefined) {
      throw new Error(`Lead ${leadId} introuvable`);
    }

    return await ensureDossier(ctx, {
      leadId: leadId!,
      projectId: args.projectId,
      actorId: actor._id,
    });
  },
});

/**
 * Création manuelle d'un dossier complet (lead `manual`/`signe` + projet + client)
 * pour une vente absente de GHL. Portage de ClientsService.createManualDossier.
 * Anti-doublon : téléphone (9 derniers chiffres, absorbe +262/0) ou email
 * (casse ignorée). Le projet est rattaché à son créateur (pas de commercial).
 */
export const createManualDossier = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    montantTotal: v.optional(v.number()),
    typeFinancement: v.optional(financingTypeValidator),
    signedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"clients">> => {
    const actor = await requireRole(ctx, BOOTSTRAP_ROLES);

    // Anti-doublon (téléphone : 9 derniers chiffres ; email : casse ignorée).
    const phoneTail = (args.phone ?? "").replace(/\D/g, "").slice(-9);
    const email = args.email?.trim().toLowerCase();
    if (phoneTail.length === 9 || email) {
      const leadsRows = await ctx.db.query("leads").collect();
      const dup = leadsRows.find((l) => {
        if (l.deletedAt !== undefined) return false;
        const lPhoneTail = (l.phone ?? "").replace(/\D/g, "").slice(-9);
        const phoneMatch = phoneTail.length === 9 && lPhoneTail === phoneTail;
        const emailMatch = Boolean(email) && (l.email ?? "").trim().toLowerCase() === email;
        return phoneMatch || emailMatch;
      });
      if (dup) {
        const name = [dup.firstName, dup.lastName].filter(Boolean).join(" ") || dup._id;
        throw new Error(`Un lead existe déjà : ${name}`);
      }
    }

    const leadId = await ctx.db.insert("leads", {
      source: "manual",
      status: "signe",
      firstName: args.firstName,
      lastName: args.lastName,
      ...(args.phone !== undefined ? { phone: args.phone } : {}),
      ...(args.email !== undefined ? { email: args.email } : {}),
      ...(args.addressLine !== undefined ? { addressLine: args.addressLine } : {}),
      ...(args.city !== undefined ? { city: args.city } : {}),
      ...(args.postalCode !== undefined ? { postalCode: args.postalCode } : {}),
    });
    const projectId = await ctx.db.insert("projects", {
      leadId,
      commercialId: actor._id,
      name: `Projet ${args.firstName} ${args.lastName}`,
      status: "signe",
    });
    return await ensureDossier(ctx, {
      leadId,
      projectId,
      montantTotal: args.montantTotal,
      typeFinancement: args.typeFinancement,
      signedAt: args.signedAt,
      actorId: actor._id,
    });
  },
});
