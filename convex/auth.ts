import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// TODO(deploy/auth-tranche): restrict OAuth (email-domain allowlist e.g. @elevenprocess.com) or default new OAuth users to active:false pending admin activation — currently any Google account becomes an active setter.
// role/active NE sont PAS posés ici : sinon chaque login réécraserait le rôle.
// roleOf() applique le défaut "setter" à la lecture ; updateRole persiste le vrai rôle.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, Password],
});
