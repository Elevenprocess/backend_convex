import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { leadStatusValidator, adChannelValidator, LEAD_STATUSES } from "./model/enums";
import { requireUser, requireRole, requireLeadWriteRole, roleOf } from "./model/access";
import type { Role } from "./model/enums";
import { normalizeSource } from "./model/acquisitionChannel";
import { insertStageHistory } from "./model/stageHistory";
import { enrichLead } from "./model/enrichLead";
import { CLIENT_VISIBLE_STATUSES, isClientVisibleLead } from "./model/clientScope";

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

// Casse + accents neutralisés, espaces multiples repliés : « José-Müller » et
// « jose muller » doivent se retrouver.
function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Variantes d'un numéro pour la recherche : chiffres seuls (les espaces/points
// ne comptent pas), équivalence +262/+33 ↔ 0…, et suffixes 8/9 chiffres pour
// matcher un numéro saisi partiellement. Miroir de la même fonction côté front.
function phoneSearchVariants(value: string): string[] {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith("262") && digits.length > 3) variants.add(`0${digits.slice(3)}`);
  if (digits.startsWith("33") && digits.length > 2) variants.add(`0${digits.slice(2)}`);
  if (digits.length >= 8) variants.add(digits.slice(-8));
  if (digits.length >= 9) variants.add(digits.slice(-9));
  return Array.from(variants).filter((variant) => variant.length >= 4);
}

// Filtres + pagination partagés entre `list` (docs bruts) et `listEnriched`
// (docs + agrégats appels/RDV — jauges 4/jour et 11 jours de la liste leads).
async function paginateLeadsPage(
  ctx: QueryCtx,
  args: {
    status?: Doc<"leads">["status"];
    setterId?: Id<"users">;
    assignedToId?: Id<"users">;
    city?: string;
    search?: string;
    scope?: "clients";
    paginationOpts: { numItems: number; cursor: string | null };
  },
) {
    let q;
    let statusViaIndex = false;
    if (args.assignedToId !== undefined) {
      // Liste commerciale : l'index prime, status/city retombent en filtre.
      q = ctx.db.query("leads").withIndex("by_assignedTo", (ix) => ix.eq("assignedToId", args.assignedToId!));
    } else if (args.status !== undefined && args.setterId !== undefined) {
      statusViaIndex = true;
      q = ctx.db.query("leads").withIndex("by_status_setter", (ix) =>
        ix.eq("status", args.status!).eq("setterId", args.setterId!),
      );
    } else if (args.status !== undefined) {
      // Tri par date métier (createdAt backfillé partout) — _creationTime est
      // arbitraire depuis la migration (ordre d'écriture des imports).
      statusViaIndex = true;
      q = ctx.db.query("leads").withIndex("by_status_createdAt", (ix) => ix.eq("status", args.status!));
    } else if (args.setterId !== undefined) {
      q = ctx.db.query("leads").withIndex("by_setter", (ix) => ix.eq("setterId", args.setterId!));
    } else {
      q = ctx.db.query("leads").withIndex("by_createdAt");
    }
    let ordered = q.order("desc").filter((f) => f.eq(f.field("deletedAt"), undefined));
    if (args.status !== undefined && !statusViaIndex) {
      ordered = ordered.filter((f) => f.eq(f.field("status"), args.status!));
    }
    // Page client : pré-filtre superset (statuts du chemin positif + leads sans
    // stage GHL, filet de secours). Le post-filtre exact par stage se fait dans
    // listEnriched après enrichissement (il a besoin de latestRdvAt/hasDevis).
    if (args.scope === "clients" && args.status === undefined) {
      ordered = ordered.filter((f) =>
        f.or(
          f.eq(f.field("ghlStageName"), undefined),
          f.eq(f.field("ghlStageName"), ""),
          ...CLIENT_VISIBLE_STATUSES.map((s) => f.eq(f.field("status"), s)),
        ),
      );
    }
    if (args.city !== undefined) {
      ordered = ordered.filter((f) => f.eq(f.field("city"), args.city!));
    }

    const needle = normalizeSearchText(args.search ?? "");
    const needlePhones = phoneSearchVariants(args.search ?? "");
    if (!needle && needlePhones.length === 0) return await ordered.paginate(args.paginationOpts);

    // Recherche plein-texte simple (nom/email/téléphone/adresse/ville), filtrée
    // en JS sur la page courante : pas de searchIndex sur leads (champs multiples).
    // Insensible à la casse ET aux accents ; les numéros matchent quels que
    // soient les espaces et le préfixe (+262/+33 ↔ 0…, cf. phoneSearchVariants).
    // On élargit la page scannée pour que les correspondances remontent vite ;
    // le curseur reste valide, le client enchaîne les loadMore normalement.
    const page = await ordered.paginate({
      ...args.paginationOpts,
      numItems: Math.max(args.paginationOpts.numItems, 300),
    });
    const matches = (l: (typeof page.page)[number]) => {
      const hay = [
        l.firstName,
        l.lastName,
        `${l.firstName ?? ""} ${l.lastName ?? ""}`,
        l.email,
        l.phone,
        l.city,
        l.addressLine,
        l.postalCode,
      ]
        .filter((s): s is string => typeof s === "string")
        .map(normalizeSearchText);
      if (needle && hay.some((s) => s.includes(needle))) return true;
      if (needlePhones.length === 0) return false;
      const leadPhones = phoneSearchVariants(l.phone ?? "");
      return needlePhones.some((qp) => leadPhones.some((lp) => lp.includes(qp) || qp.includes(lp)));
    };
    return { ...page, page: page.page.filter(matches) };
}

export const list = query({
  args: {
    status: v.optional(leadStatusValidator),
    setterId: v.optional(v.id("users")),
    assignedToId: v.optional(v.id("users")),
    city: v.optional(v.string()),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await paginateLeadsPage(ctx, args);
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
      createdAt: Date.now(),
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

export const updateStatus = mutation({
  args: { leadId: v.id("leads"), status: leadStatusValidator },
  handler: async (ctx, args) => {
    await requireLeadWriteRole(ctx);
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
    await requireLeadWriteRole(ctx);
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
    await requireLeadWriteRole(ctx);
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
  // todayStart (ms, minuit local du client) : active le compteur leadsToday —
  // TOUS les prospects arrivés aujourd'hui (date métier createdAt), non scoppé
  // au setter : le KPI « Nouveaux aujourd'hui » mesure le flux entrant global.
  args: { todayStart: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    // Commercial : scope à ses leads via l'index by_assignedTo (pas de full-scan).
    const rows = roleOf(user) === "commercial"
      ? await ctx.db.query("leads").withIndex("by_assignedTo", (q) => q.eq("assignedToId", user._id)).collect()
      : await ctx.db.query("leads").collect();
    const scoped = rows.filter((l) => l.deletedAt === undefined);
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let leadsToday = 0;
    for (const l of scoped) {
      byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      bySource[l.source] = (bySource[l.source] ?? 0) + 1;
      if (args.todayStart !== undefined && (l.createdAt ?? l._creationTime) >= args.todayStart) leadsToday++;
    }
    return {
      total: scoped.length,
      byStatus,
      bySource,
      imported: (bySource.ghl ?? 0) + (bySource.airtable_migration ?? 0),
      directGhl: bySource.ghl ?? 0,
      leadsToday: args.todayStart === undefined ? undefined : leadsToday,
    };
  },
});

// Devis en attente du commercial connecté (status rdv_honore), drapeau stale.
export const pendingQuotes = query({
  args: { now: v.number(), staleDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, SALES_MANAGER_ROLES);
    const staleDays = args.staleDays ?? 14;
    const rows = (
      await ctx.db.query("leads").withIndex("by_assignedTo", (q) => q.eq("assignedToId", user._id)).collect()
    ).filter((l) => l.deletedAt === undefined && l.status === "rdv_honore");
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
    const rows = (
      await ctx.db.query("leads").withIndex("by_assignedTo", (q) => q.eq("assignedToId", user._id)).collect()
    ).filter((l) => l.deletedAt === undefined);
    // Tous les statuts sont comptés (sinon signature_en_cours/pas_qualifie/
    // pas_de_reponse tombaient hors des compteurs alors qu'ils entrent dans openLeads).
    const counters: Record<string, number> = Object.fromEntries(
      LEAD_STATUSES.map((s) => [s, 0]),
    );
    let ca = 0, signed = 0, lost = 0, staleQuotes = 0, stuckLeads = 0;
    for (const l of rows) {
      counters[l.status] += 1;
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

// ─── Lecture enrichie (portage withLatestCalls) ──────────────────────────────

export const getEnriched = query({
  args: { leadId: v.id("leads"), now: v.number() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;
    return await enrichLead(ctx, lead, args.now);
  },
});

// Liste enrichie (agrégats appels/RDV/devis par lead) : mêmes filtres et même
// tri que `list` via paginateLeadsPage — c'est elle qui alimente les jauges
// « appels 4/jour » (callsToday) et « 11 jours » (joursRelance) de la liste.
export const listEnriched = query({
  args: {
    status: v.optional(leadStatusValidator),
    setterId: v.optional(v.id("users")),
    assignedToId: v.optional(v.id("users")),
    city: v.optional(v.string()),
    search: v.optional(v.string()),
    scope: v.optional(v.literal("clients")),
    now: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const { now, ...rest } = args;
    const page = await paginateLeadsPage(ctx, rest);
    const enriched = await Promise.all(page.page.map((lead) => enrichLead(ctx, lead, now)));
    // Page client : post-filtre autoritaire (stage exact, filet RDV/devis) — la
    // page peut raccourcir, le curseur reste valide (le client recharge la suite).
    const kept = args.scope === "clients"
      ? enriched.filter((l) => isClientVisibleLead(l, l))
      : enriched;
    return { ...page, page: kept };
  },
});
