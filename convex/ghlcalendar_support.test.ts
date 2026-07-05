import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("queries internes ghlCalendar", () => {
  it("viewerInfo : user connecté → {userId, role} ; anonyme → throw", async () => {
    const t = makeT();
    const uid = await insertUser(t, { role: "commercial" });
    expect(await asUser(t, uid).query(internal.ghlCalendar.viewerInfo, {})).toEqual({ userId: uid, role: "commercial" });
    await expect(t.query(internal.ghlCalendar.viewerInfo, {})).rejects.toThrow();
  });

  it("commercialsByGhlUserId : commerciaux actifs mappés seulement", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: "a", name: "A", role: "commercial", ghlUserId: "g1", active: true });
      await ctx.db.insert("users", { email: "b", name: "B", role: "commercial_lead", ghlUserId: "g2", active: true });
      await ctx.db.insert("users", { email: "c", name: "C", role: "commercial", active: true });            // sans mapping
      await ctx.db.insert("users", { email: "d", name: "D", role: "setter", ghlUserId: "g4", active: true }); // mauvais rôle
      await ctx.db.insert("users", { email: "e", name: "E", role: "commercial", ghlUserId: "g5", deletedAt: 1 });
    });
    const rows = await t.query(internal.ghlCalendar.commercialsByGhlUserId, {});
    expect(rows.map((r) => r.ghlUserId).sort()).toEqual(["g1", "g2"]);
  });

  it("leadSyncInfo : externalId remonté, lead supprimé → null", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", externalId: "c1" }));
    expect(await t.query(internal.ghlCalendar.leadSyncInfo, { leadId })).toEqual({ externalId: "c1" });
    const gone = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "nouveau", deletedAt: 1 }));
    expect(await t.query(internal.ghlCalendar.leadSyncInfo, { leadId: gone })).toBeNull();
  });

  it("userForMySector + setUserGhlCalendarId", async () => {
    const t = makeT();
    const uid = await insertUser(t, { role: "commercial" });
    await t.run((ctx) => ctx.db.patch(uid, { ghlUserId: "g1" }));
    expect(await t.query(internal.ghlCalendar.userForMySector, { userId: uid })).toEqual({ ghlUserId: "g1", ghlCalendarId: undefined });
    await t.mutation(internal.ghlCalendar.setUserGhlCalendarId, { userId: uid, calendarId: "cal9" });
    expect((await t.run((ctx) => ctx.db.get(uid)))?.ghlCalendarId).toBe("cal9");
  });
});
