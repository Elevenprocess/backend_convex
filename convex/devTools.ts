import { internalMutation, internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { roleValidator, teamValidator, leadStatusValidator } from "./model/enums";
import { insertStageHistory } from "./model/stageHistory";

// Outils dev uniquement — internes (jamais appelables par un client) : lancés
// via `npx convex run devTools:setRole '{"email":"…","role":"admin"}'` avec la
// deploy key. Sert à promouvoir un compte créé par signUp en environnement de
// dev (les comptes seed n'ont pas de mot de passe connu).
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) throw new Error(`Compte introuvable : ${args.email} (signup manquant)`);
    await ctx.db.patch(user._id, { role: args.role });
    return { userId: user._id, role: args.role };
  },
});

// Réparation ponctuelle : force le statut d'un lead (+ trace d'historique),
// ex. lead rétrogradé par erreur par un résultat d'appel « refus ». Lancé via
// `npx convex run devTools:setLeadStatus '{"leadId":"…","status":"rdv_pris"}'`.
export const setLeadStatus = internalMutation({
  args: { leadId: v.id("leads"), status: leadStatusValidator },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Lead introuvable");
    if (lead.status === args.status) return { changed: false, status: args.status };
    await ctx.db.patch(args.leadId, { status: args.status });
    await insertStageHistory(ctx, {
      leadId: args.leadId,
      ghlStageName: args.status,
      saasStatus: args.status,
      assignedToId: lead.assignedToId,
      changedAt: Date.now(),
      source: "manual",
    });
    return { changed: true, from: lead.status, to: args.status };
  },
});

// Crée un compte Password (mot de passe hashé via le crypto better-auth) PUIS le
// promeut admin. createAccount doit tourner dans une action (écrit via runMutation).
// Dev only — lancé via
// `npx convex run devTools:createAdmin '{"email":"…","password":"…"}'`.
export const createAdmin = internalAction({
  args: { email: v.string(), password: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: args.email, secret: args.password },
      profile: { email: args.email, name: args.name ?? "Admin Velora" },
    });
    await ctx.runMutation(internal.devTools.setRole, { email: args.email, role: "admin" });
    return { userId: user._id, email: args.email, role: "admin" };
  },
});

// Nettoyage post-sync mapGhlCommercials : soft-delete des comptes actifs dont
// le ghlUserId ne figure pas dans l'équipe GHL (source de vérité = page staff
// GHL). keepEmails protège les comptes à conserver malgré tout (ex. compte de
// connexion admin). Lancé via
// `npx convex run devTools:purgeUsersNotInGhl '{"ghlUserIds":["…"],"keepEmails":["…"],"dryRun":true}'`.
export const purgeUsersNotInGhl = internalMutation({
  args: {
    ghlUserIds: v.array(v.string()),
    keepEmails: v.optional(v.array(v.string())),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ghlIds = new Set(args.ghlUserIds);
    const keep = new Set((args.keepEmails ?? []).map((e) => e.trim().toLowerCase()));
    const purged: string[] = [];
    const kept: string[] = [];
    for (const user of await ctx.db.query("users").collect()) {
      if (user.deletedAt !== undefined) continue;
      if (user.ghlUserId && ghlIds.has(user.ghlUserId)) continue;
      const label = `${user.name ?? "?"} (${user.email ?? "sans email"})`;
      if (keep.has((user.email ?? "").toLowerCase())) {
        kept.push(label);
        continue;
      }
      if (args.dryRun !== true) await ctx.db.patch(user._id, { deletedAt: Date.now(), active: false });
      purged.push(label);
    }
    return { dryRun: args.dryRun === true, purged, kept };
  },
});

// Réparation d'un compte par email : restauration d'un soft-delete (restore)
// et/ou ajustement role/team — ex. commercial supprimé de Velora mais encore
// présent dans GHL. `npx convex run devTools:patchUserByEmail '{"email":"…","restore":true}'`.
export const patchUserByEmail = internalMutation({
  args: {
    email: v.string(),
    restore: v.optional(v.boolean()),
    role: v.optional(roleValidator),
    team: v.optional(teamValidator),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error(`Compte introuvable : ${email}`);
    await ctx.db.patch(user._id, {
      ...(args.restore === true ? { deletedAt: undefined, active: true } : {}),
      ...(args.role !== undefined ? { role: args.role } : {}),
      ...(args.team !== undefined ? { team: args.team } : {}),
      ...(args.phone !== undefined ? { phone: args.phone } : {}),
    });
    return { userId: user._id, email, restored: args.restore === true && user.deletedAt !== undefined };
  },
});


// ─── Fixture de test du lien débrief (internes, CLI uniquement) ──────────────
// createDebriefLinkFixture : lead + RDV honoré de test (sans externalId GHL →
// aucun push sortant). purgeDebriefLinkFixture : hard-delete lead/rdv/débriefs/
// projets/dossiers créés par le test pour ne pas polluer les stats.
export const createDebriefLinkFixture = internalMutation({
  args: { commercialId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const leadId = await ctx.db.insert("leads", {
      source: "manual",
      status: "rdv_honore",
      firstName: "TEST",
      lastName: "LIEN DEBRIEF — à ignorer",
      createdAt: Date.now(),
    });
    const rdvId = await ctx.db.insert("rdv", {
      leadId,
      ...(args.commercialId !== undefined ? { commercialId: args.commercialId } : {}),
      locationType: "domicile",
      status: "honore",
      scheduledAt: Date.now() - 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    return { leadId, rdvId };
  },
});

export const purgeDebriefLinkFixture = internalMutation({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !(lead.lastName ?? "").includes("LIEN DEBRIEF")) {
      throw new Error("Refus : ce lead n'est pas une fixture de test.");
    }
    let deleted = 0;
    const clientsRows = await ctx.db.query("clients").withIndex("by_lead", (q) => q.eq("leadId", args.leadId)).collect();
    for (const c of clientsRows) {
      for (const sub of await ctx.db.query("workflowSubsteps").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()) await ctx.db.delete(sub._id);
      for (const st of await ctx.db.query("workflowSteps").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()) await ctx.db.delete(st._id);
      await ctx.db.delete(c._id);
      deleted++;
    }
    for (const table of ["debriefs", "rdv", "projects"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
        .collect();
      for (const r of rows) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    await ctx.db.delete(args.leadId);
    return { deleted: deleted + 1 };
  },
});

// Réparation : leads rétrogradés à tort par un résultat d'appel alors qu'ils
// ont un RDV encore ouvert (bug corrigé dans callLogs.logCall — garde
// leadHasOpenRdv). Repasse ces leads en « qualifie ». Sans {"apply": true},
// ne fait que lister les leads concernés (dry-run).
// `npx convex run devTools:repairQualifiesAvecRdvOuvert '{"apply": true}' --prod`
export const repairQualifiesAvecRdvOuvert = internalMutation({
  args: {
    apply: v.optional(v.boolean()),
    // Restreint la réparation à certains statuts d'origine. Par défaut :
    // tous les statuts atteignables par la régression, y compris pas_qualifie
    // (qui vient d'un « refus » explicite — à réparer avec discernement).
    statuses: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Statuts atteignables par la régression de logCall uniquement : on ne
    // touche ni aux décisions terminales (perdu/signe) ni aux leads déjà bons.
    const REGRESSED = new Set(
      args.statuses ?? ["pas_de_reponse", "a_rappeler", "relance", "pas_qualifie"],
    );
    const OPEN = new Set(["planifie", "reporte"]);

    const rdvRows = await ctx.db.query("rdv").collect();
    const openLeadIds = new Set(
      rdvRows
        .filter((r) => r.deletedAt === undefined && OPEN.has(r.status))
        .map((r) => r.leadId),
    );

    const repaired: Array<{ leadId: string; from: string; name: string }> = [];
    for (const leadId of openLeadIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.deletedAt !== undefined || !REGRESSED.has(lead.status)) continue;
      repaired.push({
        leadId,
        from: lead.status,
        name: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
      });
      if (args.apply) {
        await ctx.db.patch(leadId, { status: "qualifie" });
        await insertStageHistory(ctx, {
          leadId,
          ghlStageName: "qualifie",
          saasStatus: "qualifie",
          assignedToId: lead.assignedToId,
          changedAt: Date.now(),
          source: "manual",
        });
      }
    }
    return { applied: args.apply === true, count: repaired.length, leads: repaired };
  },
});

// Diagnostic attribution commercial/setter d'un lead (par téléphone) : renvoie
// le lead, ses RDV et la résolution des users référencés — pour comprendre les
// « non assigné » de l'Overview. Lecture seule.
// `npx convex run devTools:debugRdvAttribution '{"phone":"+262692470465"}'`
export const debugRdvAttribution = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const digits = args.phone.replace(/\D/g, "").slice(-9);
    const leads = (await ctx.db.query("leads").collect()).filter(
      (l) => l.deletedAt === undefined && (l.phone ?? "").replace(/\D/g, "").endsWith(digits),
    );
    const userInfo = async (id: any) => {
      if (!id) return null;
      const u = await ctx.db.get(id as any);
      if (!u) return { id, missing: true };
      const anyU = u as any;
      return { id, name: anyU.name, role: anyU.role, active: anyU.active, deletedAt: anyU.deletedAt ?? null, ghlUserId: anyU.ghlUserId ?? null };
    };
    const out = [];
    for (const l of leads) {
      const rdvs = await ctx.db
        .query("rdv")
        .withIndex("by_lead", (q) => q.eq("leadId", l._id))
        .collect();
      out.push({
        lead: {
          id: l._id, name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(), phone: l.phone,
          status: l.status, source: l.source, ghlContactId: l.ghlContactId ?? null, externalId: l.externalId ?? null,
          setter: await userInfo(l.setterId), assignedTo: await userInfo(l.assignedToId),
          latestRdvCommercial: await userInfo((l as any).latestRdvCommercialId),
          assignedSetterIds: (l as any).assignedSetterIds ?? null,
        },
        rdvs: await Promise.all(rdvs.filter((r) => r.deletedAt === undefined).map(async (r) => ({
          id: r._id, scheduledAt: r.scheduledAt ? new Date(r.scheduledAt).toISOString() : null,
          status: r.status, ghlEventId: r.ghlEventId ?? null, externalId: r.externalId ?? null,
          commercial: await userInfo(r.commercialId),
        }))),
      });
    }
    return out;
  },
});

// Diagnostic : derniers débriefs avec le statut actuel de leur lead — pour
// comprendre les écarts « débrief non-vente mais lead à rappeler ». Lecture seule.
// `npx convex run devTools:debugRecentDebriefs '{"limit":15}'`
export const debugRecentDebriefs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("debriefs").order("desc").take(Math.min(args.limit ?? 15, 50));
    return Promise.all(rows.map(async (d) => {
      const lead = d.leadId ? await ctx.db.get(d.leadId) : null;
      const commercial = d.commercialId ? await ctx.db.get(d.commercialId) : null;
      return {
        at: new Date(d.createdAt ?? d._creationTime).toISOString(),
        outcome: d.outcome,
        nonSaleReason: d.nonSaleReason ?? null,
        reflexionReason: (d as any).reflexionReason ?? null,
        suiviReason: (d as any).suiviReason ?? null,
        commercial: (commercial as any)?.name ?? null,
        lead: lead ? { id: lead._id, name: `${(lead as any).firstName ?? ""} ${(lead as any).lastName ?? ""}`.trim(), status: (lead as any).status, ghlStageName: (lead as any).ghlStageName ?? null } : null,
      };
    }));
  },
});
