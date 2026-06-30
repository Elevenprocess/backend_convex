import { internalQuery } from "../_generated/server";
import { requireRole } from "./access";

export const whoamiAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin"]);
    return { role: user.role ?? "setter" };
  },
});
