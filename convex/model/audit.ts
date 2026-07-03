/**
 * Audit des changements de statut workflow (portage des inserts auditLog des
 * services workflow NestJS, sans ip/userAgent).
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function insertAudit(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    ...(input.before !== undefined ? { before: input.before } : {}),
    ...(input.after !== undefined ? { after: input.after } : {}),
  });
}
