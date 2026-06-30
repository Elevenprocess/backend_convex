import { TestConvex } from "convex-test";
import schema from "./schema";

type T = TestConvex<typeof schema>;

// getAuthUserId() lit identity.subject et coupe sur "|" → 1er segment = userId.
export function asUser(t: T, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session` });
}

export async function insertUser(
  t: T,
  fields: Partial<{ email: string; name: string; role: string; active: boolean }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: fields.email ?? "u@ecoi.fr",
      name: fields.name ?? "User",
      role: (fields.role as any) ?? "setter",
      active: fields.active ?? true,
    }),
  );
}
