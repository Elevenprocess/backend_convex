import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { leadStatusValidator, adChannelValidator } from "./model/enums";
import { requireUser, requireRole } from "./model/access";
import { normalizeSource } from "./model/acquisitionChannel";
import { insertStageHistory } from "./model/stageHistory";

export const get = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db.get(args.leadId);
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
    const ordered = q.order("desc");
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
