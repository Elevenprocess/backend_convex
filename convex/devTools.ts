import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { roleValidator } from "./model/enums";

// Outils dev uniquement — internes (jamais appelables par un client) : lancés
// via `npx convex run devTools:setRole '{"email":"…","role":"admin"}'` avec la
// deploy key. Sert à promouvoir un compte créé par signUp en environnement de
// dev (les comptes seed n'ont pas de mot de passe connu).
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) throw new Error(`Compte introuvable : ${args.email} (signup manquant)`);
    await ctx.db.patch(user._id, { role: args.role });
    return { userId: user._id, role: args.role };
  },
});
