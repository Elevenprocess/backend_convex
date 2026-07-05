import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

async function seedAdmin(t: ReturnType<typeof makeT>) {
  const adminId = await insertUser(t, { role: "admin", email: "a@ecoi.fr" });
  return asUser(t, adminId);
}

describe("sourceMap admin", () => {
  it("réservé admin (setter → refus)", async () => {
    const t = makeT();
    const setterId = await insertUser(t, { role: "setter" });
    await expect(
      asUser(t, setterId).mutation(api.leads.sourceMapUpsert, {
        rawSource: "x", channel: "other", label: "X",
      }),
    ).rejects.toThrow();
  });

  it("upsert normalise rawSource et met à jour au conflit", async () => {
    const t = makeT();
    const admin = await seedAdmin(t);
    await admin.mutation(api.leads.sourceMapUpsert, {
      rawSource: " Salon Habitat ", channel: "other", label: "Salon",
    });
    await admin.mutation(api.leads.sourceMapUpsert, {
      rawSource: "salon habitat", channel: "referral", label: "Salon 2026",
    });
    const rows = await admin.query(api.leads.sourceMapList, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rawSource: "salon habitat", channel: "referral", label: "Salon 2026",
    });
  });

  it("reapply reclasse UNIQUEMENT les leads other/null qui matchent", async () => {
    const t = makeT();
    const admin = await seedAdmin(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("leads", {
        source: "ghl", status: "nouveau",
        canalAcquisition: "Salon Habitat", acquisitionChannel: "other",
      });
      await ctx.db.insert("leads", {
        source: "ghl", status: "nouveau", canalAcquisition: "salon habitat",
      }); // channel absent (null) → reclassé aussi
      await ctx.db.insert("leads", {
        source: "ghl", status: "nouveau",
        canalAcquisition: "salon habitat", acquisitionChannel: "meta",
      }); // déjà classé meta → intouché
    });
    const { reapplied } = await admin.mutation(api.leads.sourceMapUpsert, {
      rawSource: "salon habitat", channel: "referral", label: "Salon", reapply: true,
    });
    expect(reapplied).toBe(2);
    const leads = await t.run((ctx) => ctx.db.query("leads").collect());
    expect(leads.filter((l) => l.acquisitionChannel === "referral")).toHaveLength(2);
    expect(leads.filter((l) => l.acquisitionChannel === "meta")).toHaveLength(1);
  });

  it("unmapped : sources brutes des leads other absentes de la table, par fréquence", async () => {
    const t = makeT();
    const admin = await seedAdmin(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("acquisitionSourceMap", {
        rawSource: "connu", channel: "referral", label: "Connu",
      });
      for (const raw of ["Mystère", "mystère", "connu", "Autre Source"]) {
        await ctx.db.insert("leads", {
          source: "ghl", status: "nouveau",
          canalAcquisition: raw, acquisitionChannel: "other",
        });
      }
    });
    const unmapped = await admin.query(api.leads.sourceMapUnmapped, {});
    expect(unmapped).toEqual([
      { raw: "mystère", n: 2 },
      { raw: "autre source", n: 1 },
    ]);
  });
});
