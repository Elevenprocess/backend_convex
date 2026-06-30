import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireRole, assertCommercialRole } from "./access";

export const whoamiAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin"]);
    return { role: user.role ?? "setter" };
  },
});

export const assertCommercialOk = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const u = await assertCommercialRole(ctx, args.userId);
    return { role: u.role ?? "setter" };
  },
});
