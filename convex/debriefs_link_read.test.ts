import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { makeT } from "./test.kit";
import { outcomeToResult } from "./debriefs";

describe("outcomeToResult", () => {
  it("mappe outcome + raison", () => {
    expect(outcomeToResult("vente", undefined)).toBe("signe");
    expect(outcomeToResult("non_vente", "no_show")).toBe("no_show");
    expect(outcomeToResult("non_vente", "suivi_prevu")).toBe("reflexion");
    expect(outcomeToResult("non_vente", "trop_cher")).toBe("perdu");
    expect(outcomeToResult("non_vente", undefined)).toBe("perdu");
    expect(outcomeToResult("autre", undefined)).toBeUndefined();
  });
});

describe("linkReadData", () => {
  it("charge client + commercial + rdv + débrief existant", async () => {
    const t = makeT();
    const commercialId = await t.run((ctx) => ctx.db.insert("users", { email: "c@e.fr", name: "Paul Payet", role: "commercial", active: true }));
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie", firstName: "Jean", lastName: "Hoarau", email: "j@h.re", phone: "0692" }));
    const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, commercialId, locationType: "domicile", status: "honore", scheduledAt: 1000, debriefFilledAt: 2000 }));
    await t.run((ctx) => ctx.db.insert("debriefs", { leadId, commercialId, outcome: "vente", rdvId, acceptanceFactors: [], customEcheancier: false, notes: "RAS", montantTotal: 15000 }));
    const data = await t.query(internal.debriefs.linkReadData, { rdvId });
    expect(data?.client).toMatchObject({ firstName: "Jean", lastName: "Hoarau", email: "j@h.re", phone: "0692" });
    expect(data?.commercialName).toBe("Paul Payet");
    expect(data?.rdv).toMatchObject({ id: rdvId, scheduledAt: 1000, status: "honore", alreadyDebriefed: true });
    expect(data?.debrief).toMatchObject({ outcome: "vente", montantTotal: 15000 });
  });

  it("RDV absent/supprimé → null ; RDV sans débrief → debrief null", async () => {
    const t = makeT();
    const leadId = await t.run((ctx) => ctx.db.insert("leads", { source: "ghl", status: "qualifie" }));
    const rdvId = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "planifie" }));
    const data = await t.query(internal.debriefs.linkReadData, { rdvId });
    expect(data?.rdv.alreadyDebriefed).toBe(false);
    expect(data?.debrief).toBeNull();
    const del = await t.run((ctx) => ctx.db.insert("rdv", { leadId, locationType: "domicile", status: "annule", deletedAt: 1 }));
    expect(await t.query(internal.debriefs.linkReadData, { rdvId: del })).toBeNull();
  });
});
