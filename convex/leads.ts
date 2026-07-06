import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { leadStatusValidator, adChannelValidator } from "./model/enums";
import { requireUser, requireRole, roleOf } from "./model/access";
import type { Role } from "./model/enums";
import { normalizeSource } from "./model/acquisitionChannel";
import { insertStageHistory } from "./model/stageHistory";

export const get = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    return lead;
  },
});

export const softDelete = mutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db.get(args.leadId);
    if (!existing || existing.deletedAt !== undefined) throw new Error("Lead introuvable");
    await ctx.db.patch(args.leadId, { deletedAt: Date.now() });
    return null;
  },
});

export const list = query({
  args: {
    status: v.optional(leadStatusValidator),
    setterId: v.optional(v.id("users")),
    city: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let q;
    if (args.status !== undefined && args.setterId !== undefined) {
      q = ctx.db.query("leads").withIndex("by_status_setter", (ix) =>
        ix.eq("status", args.status!).eq("setterId", args.setterId!),
      );
    } else if (args.status !== undefined) {
      q = ctx.db.query("leads").withIndex("by_status_setter", (ix) => ix.eq("status", args.status!));
    } else if (args.setterId !== undefined) {
      q = ctx.db.query("leads").withIndex("by_setter", (ix) => ix.eq("setterId", args.setterId!));
    } else {
      q = ctx.db.query("leads");
    }
    const ordered = q.order("desc").filter((f) => f.eq(f.field("deletedAt"), undefined));
    if (args.city !== undefined) {
      return await ordered.filter((f) => f.eq(f.field("city"), args.city!)).paginate(args.paginationOpts);
    }
    return await ordered.paginate(args.paginationOpts);
  },
});

export const create = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    revenuFiscal: v.optional(v.number()),
    typeLogement: v.optional(v.string()),
    referrerId: v.optional(v.id("referrers")),
    // Saisie manuelle (prospect ou client) : statut initial, commercial assigné
    // et canal d'acquisition proviennent du formulaire.
    status: v.optional(leadStatusValidator),
    assignedToId: v.optional(v.id("users")),
    canalAcquisition: v.optional(v.string()),
    acquisitionChannel: v.optional(adChannelValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [
      "admin", "setter", "setter_lead", "commercial", "commercial_lead",
    ]);
    return await ctx.db.insert("leads", {
      ...args,
      source: "manual",
      status: args.status ?? "nouveau",
      setterId: user._id,
    });
  },
});

export const assignSetter = mutation({
  args: { leadId: v.id("leads"), setterId: v.id("users") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "setter_lead"]);
    await ctx.db.patch(args.leadId, { setterId: args.setterId });
    return null;
  },
});

export const assignCommercial = mutation({
  args: { leadId: v.id("leads"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "commercial_lead", "setter_lead"]);
    await ctx.db.patch(args.leadId, { assignedToId: args.userId });
    return null;
  },
});

// TODO(workflow-tranche): decide whether to role-gate lead-state mutations (currently any authenticated role). See final review #3.
export const updateStatus = mutation({
  args: { leadId: v.id("leads"), status: leadStatusValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    if (lead.status === args.status) return null; // pas de mouvement
    await ctx.db.patch(args.leadId, { status: args.status });
    await insertStageHistory(ctx, {
      leadId: args.leadId,
      ghlStageName: args.status, // entrées manuelles : libellé = statut SaaS
      saasStatus: args.status,
      assignedToId: lead.assignedToId,
      changedAt: Date.now(),
      source: "manual",
    });
    return null;
  },
});

export const qualify = mutation({
  args: { leadId: v.id("leads"), qualified: v.boolean() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    const status = args.qualified ? "qualifie" : "pas_qualifie";
    if (lead.status === status) return null;
    await ctx.db.patch(args.leadId, { status });
    await insertStageHistory(ctx, {
      leadId: args.leadId,
      ghlStageName: status,
      saasStatus: status,
      assignedToId: lead.assignedToId,
      changedAt: Date.now(),
      source: "manual",
    });
    return null;
  },
});

// Édition d'un lead (fiche + statut). Miroir de LeadsController.update : patch
// partiel des champs identité/adresse + statut, avec historique de stage sur
// changement de statut (comme updateStatus/qualify).
export const update = mutation({
  args: {
    leadId: v.id("leads"),
    status: v.optional(leadStatusValidator),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    localisationMap: v.optional(v.string()),
    revenuFiscal: v.optional(v.number()),
    typeLogement: v.optional(v.string()),
    datePassageRelance: v.optional(v.number()),
    assignedToId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const { leadId, ...rest } = args;
    const lead = await ctx.db.get(leadId);
    if (!lead) throw new Error("Lead introuvable");
    // Ne patche que les champs réellement transmis (undefined = non fourni).
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    const statusChanged = args.status !== undefined && args.status !== lead.status;
    if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
    if (statusChanged) {
      await insertStageHistory(ctx, {
        leadId,
        ghlStageName: args.status!,
        saasStatus: args.status!,
        assignedToId: args.assignedToId ?? lead.assignedToId,
        changedAt: Date.now(),
        source: "manual",
      });
    }
    return await ctx.db.get(leadId);
  },
});

// ─── Sources à classer (portage SourceMapService, Tranche 8a) ─────────────────

export const sourceMapUpsert = mutation({
  args: {
    rawSource: v.string(),
    channel: adChannelValidator,
    label: v.string(),
    reapply: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const normalized = normalizeSource(args.rawSource);

    const existing = await ctx.db
      .query("acquisitionSourceMap")
      .withIndex("by_rawSource", (q) => q.eq("rawSource", normalized))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        channel: args.channel, label: args.label, updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("acquisitionSourceMap", {
        rawSource: normalized, channel: args.channel, label: args.label,
      });
    }

    // Reclasse les leads en fallback (`other`/absent) UNIQUEMENT — ne jamais
    // écraser une classification utm/fbclid prioritaire (parité NestJS).
    let reapplied = 0;
    if (args.reapply) {
      const all = await ctx.db.query("leads").collect();
      for (const lead of all) {
        const raw = normalizeSource(lead.canalAcquisition);
        const isFallback =
          lead.acquisitionChannel === undefined || lead.acquisitionChannel === "other";
        if (raw === normalized && isFallback) {
          await ctx.db.patch(lead._id, { acquisitionChannel: args.channel });
          reapplied += 1;
        }
      }
    }
    return { reapplied };
  },
});

export const sourceMapList = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return await ctx.db.query("acquisitionSourceMap").collect();
  },
});

export const sourceMapUnmapped = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const mapped = new Set(
      (await ctx.db.query("acquisitionSourceMap").collect()).map((r) => r.rawSource),
    );
    const counts = new Map();
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_acquisitionChannel", (q) => q.eq("acquisitionChannel", "other"))
      .collect();
    for (const lead of leads) {
      const raw = normalizeSource(lead.canalAcquisition);
      if (!raw || mapped.has(raw)) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([raw, n]) => ({ raw, n }))
      .sort((a, b) => b.n - a.n);
  },
});

// ─── Vues stats / dashboards (portage leads.service.ts) ───────────────────────

const DAY_MS = 86_400_000;
const SALES_MANAGER_ROLES: Role[] = ["admin", "commercial", "commercial_lead"];

async function daysSinceLastStageChange(
  ctx: Parameters<typeof requireUser>[0],
  leadId: import("./_generated/dataModel").Id<"leads">,
  now: number,
): Promise<number | undefined> {
  const latest = await ctx.db
    .query("leadStageHistory")
    .withIndex("by_lead_changedAt", (q) => q.eq("leadId", leadId))
    .order("desc")
    .first();
  if (!latest) return undefined;
  return Math.floor((now - latest.changedAt) / DAY_MS);
}

// Stats globales leads (commercial scopé à ses leads assignés).
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const all = await ctx.db.query("leads").collect();
    const scoped = all.filter((l) => {
      if (l.deletedAt !== undefined) return false;
      if (roleOf(user) === "commercial") return l.assignedToId === user._id;
      return true;
    });
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const l of scoped) {
      byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    }
    return {
      total: scoped.length,
      byStatus,
      bySource,
      imported: (bySource.ghl ?? 0) + (bySource.airtable_migration ?? 0),
      directGhl: bySource.ghl ?? 0,
    };
  },
});

// Devis en attente du commercial connecté (status rdv_honore), drapeau stale.
export const pendingQuotes = query({
  args: { now: v.number(), staleDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, SALES_MANAGER_ROLES);
    const staleDays = args.staleDays ?? 14;
    const rows = (await ctx.db.query("leads").collect()).filter(
      (l) => l.deletedAt === undefined && l.assignedToId === user._id && l.status === "rdv_honore",
    );
    const list = await Promise.all(
      rows.map(async (l) => {
        const days = await daysSinceLastStageChange(ctx, l._id, args.now);
        return {
          id: l._id,
          firstName: l.firstName,
          lastName: l.lastName,
          email: l.email,
          phone: l.phone,
          monetaryValue: l.monetaryValue,
          ghlStageName: l.ghlStageName,
          daysSinceLastStageChange: days,
          isStale: (days ?? 0) >= staleDays,
        };
      }),
    );
    list.sort((a, b) => (b.daysSinceLastStageChange ?? 0) - (a.daysSinceLastStageChange ?? 0));
    return { total: list.length, stale: list.filter((l) => l.isStale).length, staleDays, leads: list };
  },
});

// Dashboard commercial : compteurs par statut + KPIs + alertes.
export const dashboard = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, SALES_MANAGER_ROLES);
    const rows = (await ctx.db.query("leads").collect()).filter(
      (l) => l.deletedAt === undefined && l.assignedToId === user._id,
    );
    const counters: Record<string, number> = {
      nouveau: 0, qualifie: 0, rdv_pris: 0, rdv_honore: 0, signe: 0, perdu: 0, relance: 0, a_rappeler: 0,
    };
    let ca = 0, signed = 0, lost = 0, staleQuotes = 0, stuckLeads = 0;
    for (const l of rows) {
      if (l.status in counters) counters[l.status] += 1;
      if (l.status === "signe") { signed += 1; ca += l.monetaryValue ?? 0; }
      if (l.status === "perdu") lost += 1;
      const days = (await daysSinceLastStageChange(ctx, l._id, args.now)) ?? 0;
      if (l.status === "rdv_honore" && days >= 14) staleQuotes += 1;
      if (l.status !== "signe" && l.status !== "perdu" && days >= 30) stuckLeads += 1;
    }
    const openLeads = rows.filter((l) => l.status !== "signe" && l.status !== "perdu").length;
    const denom = signed + lost;
    return {
      counters,
      totals: { openLeads, ca, signed, lost, closingRate: denom > 0 ? signed / denom : 0 },
      alerts: { staleQuotes, stuckLeads },
    };
  },
});
