/**
 * Création de notifications (portage de NotificationsService.createAndEmit :
 * l'insert suffit, la réactivité Convex remplace l'emit socket).
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function createNotification(
  ctx: MutationCtx,
  input: {
    userId: Id<"users">;
    type: string;
    title: string;
    body?: string;
    payload?: unknown;
  },
): Promise<Id<"notifications">> {
  return await ctx.db.insert("notifications", {
    userId: input.userId,
    type: input.type,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  });
}
