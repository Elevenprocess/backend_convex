import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// role/active NE sont PAS posés ici : sinon chaque login réécraserait le rôle.
// roleOf() applique le défaut "setter" à la lecture ; updateRole persiste le vrai rôle.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, Password],
});
