import { internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { roleValidator, leadStatusValidator } from "./model/enums";
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

