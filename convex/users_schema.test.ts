import { expect, test } from "vitest";
import { makeT } from "./test";

test("on peut insérer un user métier avec rôle et externalId", async () => {
  const t = makeT();
  const id = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: "setter@ecoi.fr",
      name: "Sétteur Test",
      role: "setter",
      active: true,
      externalId: "rec_airtable_123",
    });
  });
  const user = await t.run(async (ctx) => ctx.db.get(id));
  expect(user?.role).toBe("setter");
  expect(user?.externalId).toBe("rec_airtable_123");
});

test("la table authAccounts existe (Convex Auth)", async () => {
  const t = makeT();
  const n = await t.run(async (ctx) => (await ctx.db.query("authAccounts").take(1)).length);
  expect(n).toBe(0);
});
