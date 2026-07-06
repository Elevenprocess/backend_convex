import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { makeT } from "./test.kit";
import { asUser, insertUser } from "./test.helpers";

describe("commercialObjectives", () => {
  it("upsert crée puis met à jour (pas de doublon commercial×période)", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const comId = await insertUser(t, { role: "commercial" });

    await asUser(t, adminId).mutation(api.commercialObjectives.upsert, {
      commercialId: comId, period: "2026-07", caTarget: 50000, ventesTarget: 5, rdvTarget: 20, closingTarget: 40,
    });
    await asUser(t, adminId).mutation(api.commercialObjectives.upsert, {
      commercialId: comId, period: "2026-07", caTarget: 60000,
    });

    const rows = await asUser(t, adminId).query(api.commercialObjectives.listByPeriod, { period: "2026-07" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ commercialId: comId, period: "2026-07", caTarget: 60000 });
    // upsert complet remplace les cibles → ventesTarget effacé
    expect(rows[0].ventesTarget).toBeUndefined();
  });

  it("listByPeriod filtre la période ; rôle non manager refusé", async () => {
    const t = makeT();
    const adminId = await insertUser(t, { role: "admin" });
    const comId = await insertUser(t, { role: "commercial" });
    await asUser(t, adminId).mutation(api.commercialObjectives.upsert, { commercialId: comId, period: "2026-06", caTarget: 1 });
    expect(await asUser(t, adminId).query(api.commercialObjectives.listByPeriod, { period: "2026-07" })).toHaveLength(0);
    await expect(asUser(t, comId).query(api.commercialObjectives.listByPeriod, { period: "2026-06" })).rejects.toThrow();
    await expect(asUser(t, comId).mutation(api.commercialObjectives.upsert, { commercialId: comId, period: "2026-06", caTarget: 9 })).rejects.toThrow();
  });
});
