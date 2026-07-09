import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { hashSecret, verifySecret } from "./model/passwordCrypto";

// role/active NE sont PAS posés ici : sinon chaque login réécraserait le rôle.
// roleOf() applique le défaut "setter" à la lecture ; updateRole persiste le vrai rôle.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    // crypto compatible better-auth : les hashs migrés de NestJS restent valides.
    Password({ crypto: { hashSecret, verifySecret } }),
  ],
  callbacks: {
    // Le frontend est servi depuis plusieurs domaines (vercel.app + domaine
    // custom) ; le callback par défaut n'accepte que SITE_URL, on élargit.
    async redirect({ redirectTo }) {
      const allowedOrigins = [
        process.env.SITE_URL,
        "https://ecoi-frontend.vercel.app",
        "https://velora.electroconceptoi.com",
      ]
        .filter((url): url is string => typeof url === "string")
        .map((url) => url.replace(/\/$/, ""));

      // Chemin relatif → résolu contre SITE_URL (comportement par défaut).
      if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) {
        return `${allowedOrigins[0]}${redirectTo}`;
      }
      for (const origin of allowedOrigins) {
        if (redirectTo.startsWith(origin)) {
          const after = redirectTo[origin.length];
          if (after === undefined || after === "?" || after === "/") {
            return redirectTo;
          }
        }
      }
      throw new ConvexError(`Redirection non autorisée : ${redirectTo}`);
    },
    // Politique d'accès : la connexion Google (OAuth) ne connecte QUE des
    // utilisateurs déjà présents en base. Aucune création de compte via Google.
    // La création reste réservée à l'admin (flux Password : invitation/seed).
    async createOrUpdateUser(ctx, args) {
      // Compte déjà lié à ce provider → connexion normale.
      if (args.existingUserId) return args.existingUserId;

      // Rattachement par email : un utilisateur déjà en base (migré ou créé par
      // l'admin) se connecte sur SON compte, sans doublon.
      const email = typeof args.profile.email === "string" ? args.profile.email : undefined;
      if (email) {
        // ctx est typé AnyDataModel (index applicatifs inconnus) → cast local.
        const existing = await (ctx.db.query("users") as any)
          .withIndex("email", (q: any) => q.eq("email", email))
          .unique();
        if (existing) return existing._id;
      }

      // Aucun compte existant :
      //  - OAuth (Google) → REFUS (pas d'auto-création).
      //  - Password (invitation/admin) → création autorisée.
      if (args.type === "oauth") {
        throw new ConvexError("Aucun compte VELORA n'est associé à ce compte Google.");
      }
      return await ctx.db.insert("users", {
        email,
        name: typeof args.profile.name === "string" ? args.profile.name : undefined,
      });
    },
  },
});
